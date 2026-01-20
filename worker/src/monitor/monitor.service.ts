import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios'; // Import HttpService
import { AxiosError, Method } from 'axios'; // Import Method from axios
import { firstValueFrom } from 'rxjs'; // To convert Observable to Promise
import { MonitorJobDataDto } from './dto/monitor-job.dto';
import { MonitorExecutionResult } from './types/monitor-result.type';
import { DbService } from '../db/db.service';
import { ExecutionService } from '../execution/services/execution.service';
import { UsageTrackerService } from '../execution/services/usage-tracker.service';
import * as schema from '../db/schema'; // Assuming your schema is here and WILL contain monitorResults
import type {
  MonitorConfig,
  MonitorResultStatus,
  MonitorResultDetails,
  monitorsSelectSchema,
  monitorResultsSelectSchema,
} from '../db/schema';
import type { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { MonitorAlertService } from './services/monitor-alert.service';
import { ValidationService } from '../common/validation/validation.service';
import {
  EnhancedValidationService,
  SecurityConfig,
} from '../common/validation/enhanced-validation.service';
import {
  CredentialSecurityService,
  CredentialData,
} from '../common/security/credential-security.service';
import {
  StandardizedErrorHandler,
  ErrorContext,
} from '../common/errors/standardized-error-handler';
import { ResourceManagerService } from '../common/resources/resource-manager.service';
import {
  LocationService,
  MonitoringLocation,
  MONITORING_LOCATIONS,
} from '../common/location/location.service';

// Import shared constants
import {
  TIMEOUTS,
  TIMEOUTS_SECONDS,
  MEMORY_LIMITS,
  SECURITY,
} from '../common/constants';

// Import shared validation utilities
import {
  validateTargetUrl,
  validatePingTarget,
  validatePortCheckTarget,
  isExpectedStatus,
  sanitizeResponseBody,
  maskCredentials,
  getErrorMessage,
} from '../common/validation';
import { RedisService } from '../execution/services/redis.service';

// Use the Monitor type from schema
type Monitor = z.infer<typeof monitorsSelectSchema>;

// Use the MonitorResult type from schema
type MonitorResult = z.infer<typeof monitorResultsSelectSchema>;

// Redis key constants for aggregation coordination
const REDIS_AGGREGATION_KEY_PREFIX = 'monitor:aggr:';
const REDIS_AGGREGATION_TTL_SECONDS = 120; // 2 minutes - enough time for all locations to report

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  private static readonly AGGREGATION_MAX_RETRIES = 3;
  private static readonly AGGREGATION_RETRY_DELAY_MS = 200; // Reduced from 500ms since Redis is fast

  constructor(
    private readonly dbService: DbService,
    private readonly httpService: HttpService,
    private readonly monitorAlertService: MonitorAlertService,
    private readonly validationService: ValidationService,
    private readonly enhancedValidationService: EnhancedValidationService,
    private readonly credentialSecurityService: CredentialSecurityService,
    private readonly errorHandler: StandardizedErrorHandler,
    private readonly resourceManager: ResourceManagerService,
    private readonly executionService: ExecutionService,
    private readonly locationService: LocationService,
    private readonly usageTrackerService: UsageTrackerService,
    private readonly redisService: RedisService, // Added for aggregation coordination
  ) {}

  async executeMonitor(
    jobData: MonitorJobDataDto,
    location: MonitoringLocation = MONITORING_LOCATIONS.EU_CENTRAL,
  ): Promise<MonitorExecutionResult | null> {
    // Removed log - only log warnings, errors, and status changes

    // Check if monitor is paused before execution
    try {
      const monitor = await this.dbService.db.query.monitors.findFirst({
        where: (monitors, { eq }) => eq(monitors.id, jobData.monitorId),
      });

      if (!monitor) {
        this.logger.warn(
          `Monitor ${jobData.monitorId} not found in database, skipping execution`,
        );
        return {
          monitorId: jobData.monitorId,
          location,
          status: 'error',
          checkedAt: new Date(),
          responseTimeMs: undefined,
          details: { errorMessage: 'Monitor not found' },
          isUp: false,
          error: 'Monitor not found',
        };
      }

      if (monitor.status === 'paused') {
        // Removed log - paused execution is not an error
        // Return null instead of a failed result - paused monitors shouldn't create results
        return null;
      }
    } catch (dbError) {
      this.logger.error(
        `Failed to check monitor status for ${jobData.monitorId}: ${getErrorMessage(dbError)}`,
      );
      // Continue with execution if we can't verify status
    }

    let status: MonitorResultStatus = 'error';
    let details: MonitorResultDetails = {};
    let responseTimeMs: number | undefined;
    let isUp = false;
    let executionError: string | undefined;
    let testExecutionId: string | undefined;
    let testReportS3Url: string | undefined;

    try {
      switch (jobData.type) {
        case 'http_request':
          ({ status, details, responseTimeMs, isUp } =
            await this.executeHttpRequest(jobData.target, jobData.config));
          break;
        case 'website': {
          // Website monitoring - allow user configuration but provide sensible defaults
          const websiteConfig = {
            ...jobData.config,
            // Allow method override from user config, default to GET for websites
            method: jobData.config?.method || 'GET',
            // Allow user-configured status codes, default to 200-299 for websites
            expectedStatusCodes:
              jobData.config?.expectedStatusCodes || '200-299',
          };
          ({ status, details, responseTimeMs, isUp } =
            await this.executeHttpRequest(jobData.target, websiteConfig));

          // SSL checking - check independently of website success for better monitoring
          if (
            jobData.config?.enableSslCheck &&
            jobData.target.startsWith('https://')
          ) {
            let shouldCheckSsl = true;
            try {
              shouldCheckSsl = await this.shouldPerformSslCheck(
                jobData.monitorId,
                jobData.config,
              );
            } catch (sslFreqError) {
              this.logger.warn(
                `SSL frequency check failed for monitor ${jobData.monitorId}, defaulting to check SSL:`,
                sslFreqError,
              );
              shouldCheckSsl = true; // Default to checking SSL if frequency logic fails
            }

            if (shouldCheckSsl) {
              try {
                const sslResult = await this.executeSslCheck(jobData.target, {
                  sslDaysUntilExpirationWarning:
                    jobData.config.sslDaysUntilExpirationWarning ??
                    SECURITY.SSL_DEFAULT_WARNING_DAYS,
                  timeoutSeconds:
                    jobData.config.timeoutSeconds ??
                    TIMEOUTS_SECONDS.SSL_CHECK_DEFAULT,
                });

                // Update SSL last checked timestamp (non-blocking)
                try {
                  await this.updateSslLastChecked(jobData.monitorId);
                } catch (updateError) {
                  this.logger.warn(
                    `Failed to update SSL last checked timestamp for monitor ${jobData.monitorId}:`,
                    updateError,
                  );
                }

                // Merge SSL certificate info into the website check details
                if (sslResult.details?.sslCertificate) {
                  details.sslCertificate = sslResult.details
                    .sslCertificate as any;
                }

                // Handle SSL check results more intelligently
                if (!sslResult.isUp) {
                  if (sslResult.details?.warningMessage) {
                    // SSL warning (e.g., certificate expiring soon) - don't fail the website check
                    details.sslWarning = sslResult.details
                      .warningMessage as string;
                  } else {
                    // SSL critical failure (e.g., expired certificate, invalid certificate)
                    // This should fail the overall website check as it affects security
                    if (isUp) {
                      // Website was up but SSL failed - combine the statuses
                      status = 'down';
                      isUp = false;
                      const websiteStatus = details.statusCode
                        ? ` (HTTP ${details.statusCode})`
                        : '';
                      details.errorMessage = `Website accessible${websiteStatus}, but SSL certificate check failed: ${
                        (sslResult.details?.errorMessage as string) ||
                        'SSL certificate invalid'
                      }`;
                    } else {
                      // Website was already down - just add SSL info
                      details.sslError =
                        (sslResult.details?.errorMessage as string) ||
                        'SSL certificate check failed';
                    }
                  }
                }
              } catch (sslError) {
                this.logger.warn(
                  `SSL check failed for website monitor ${jobData.monitorId}: ${getErrorMessage(sslError)}`,
                );
                details.sslWarning = `SSL check failed: ${getErrorMessage(sslError)}`;
              }
            } else {
              this.logger.debug(
                `Skipping SSL check for monitor ${jobData.monitorId} - not due for check`,
              );
            }
          }
          break;
        }
        case 'ping_host':
          ({ status, details, responseTimeMs, isUp } =
            await this.executePingHost(jobData.target, jobData.config)) as {
            status: MonitorResultStatus;
            details: MonitorResultDetails;
            responseTimeMs?: number;
            isUp: boolean;
          };
          break;
        case 'port_check':
          ({ status, details, responseTimeMs, isUp } =
            await this.executePortCheck(jobData.target, jobData.config)) as {
            status: MonitorResultStatus;
            details: MonitorResultDetails;
            responseTimeMs?: number;
            isUp: boolean;
          };
          break;

        case 'synthetic_test': {
          const syntheticResult = await this.executeSyntheticTest(
            jobData.monitorId,
            jobData.config,
          );
          status = syntheticResult.status;
          details = syntheticResult.details;
          responseTimeMs = syntheticResult.responseTimeMs;
          isUp = syntheticResult.isUp;
          // Preserve test execution metadata for synthetic monitors
          testExecutionId = syntheticResult.testExecutionId;
          testReportS3Url = syntheticResult.testReportS3Url;
          break;
        }

        default: {
          const _exhaustiveCheck: never = jobData.type;
          this.logger.warn(`Unsupported monitor type: ${String(jobData.type)}`);
          executionError = `Unsupported monitor type: ${String(jobData.type)}`;
          status = 'error';
          isUp = false;
          // Use the exhaustive check to ensure all cases are handled
          return _exhaustiveCheck;
        }
      }
    } catch (error) {
      this.logger.error(
        `Error executing monitor ${jobData.monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      executionError = getErrorMessage(error);
      status = 'error';
      isUp = false;
      if (details) {
        // Ensure details is defined before assigning to it
        details.errorMessage = getErrorMessage(error);
      } else {
        details = { errorMessage: getErrorMessage(error) };
      }
    }

    const result: MonitorExecutionResult = {
      monitorId: jobData.monitorId,
      location,
      status,
      checkedAt: new Date(),
      responseTimeMs,
      details: {
        ...details,
        location: this.locationService.getLocationDisplayName(location),
      },
      isUp,
      error: executionError,
      testExecutionId,
      testReportS3Url,
    };

    // The service now returns the result instead of saving it.
    // The processor will handle sending this result back to the Next.js app.
    // Removed log - only log status changes below in saveMonitorResult
    return result;
  }

  /**
   * Execute monitor from multiple locations if multi-location monitoring is enabled.
   * Returns array of results, one for each location.
   */
  async executeMonitorWithLocations(
    jobData: MonitorJobDataDto,
  ): Promise<MonitorExecutionResult[]> {
    const monitor = await this.dbService.db.query.monitors.findFirst({
      where: (monitors, { eq }) => eq(monitors.id, jobData.monitorId),
    });

    if (!monitor) {
      this.logger.warn(
        `Monitor ${jobData.monitorId} not found, returning single default location result`,
      );
      const result = await this.executeMonitor(jobData);
      return result ? [result] : [];
    }

    const monitorConfig = monitor.config ?? null;
    const locationConfig = monitorConfig?.locationConfig ?? null;
    const locations =
      this.locationService.getEffectiveLocations(locationConfig);

    // Ensure the job data includes the latest monitor configuration (including synthetic metadata)
    const resolvedJobData: MonitorJobDataDto = {
      ...jobData,
      config: jobData.config ?? monitorConfig ?? undefined,
    };

    this.logger.debug(
      `Executing monitor ${jobData.monitorId} from ${locations.length} location(s): ${locations.join(', ')}`,
    );

    // Execute from all locations in parallel
    const results = await Promise.all(
      locations.map((location) =>
        this.executeMonitor(resolvedJobData, location),
      ),
    );

    // Filter out null results (paused monitors)
    return results.filter((r) => r !== null);
  }

  /**
   * Save results from multiple locations and calculate aggregated status.
   */
  async saveMonitorResults(
    results: MonitorExecutionResult[],
    options?: { persisted?: boolean },
  ): Promise<void> {
    if (results.length === 0) {
      this.logger.warn('No results to save');
      return;
    }

    const monitorId = results[0].monitorId;
    const monitor = await this.getMonitorById(monitorId);

    if (!monitor) {
      this.logger.warn(`Monitor ${monitorId} not found, skipping save`);
      return;
    }

    // Save all location results in parallel
    if (!options?.persisted) {
      await Promise.all(
        results.map((result) => this.saveMonitorResultToDb(result)),
      );
    }

    // Calculate aggregated status
    const monitorConfig = monitor.config ?? null;
    const locationConfig = monitorConfig?.locationConfig ?? null;

    // Build location statuses map from results
    const locationStatuses = results.reduce(
      (acc, result) => {
        acc[result.location] = result.isUp;
        return acc;
      },
      {} as Record<MonitoringLocation, boolean>,
    );

    // Determine overall status based on threshold
    let overallStatus: 'up' | 'down' = 'down';
    if (
      locationConfig &&
      locationConfig.enabled &&
      locationConfig.locations &&
      locationConfig.locations.length > 0
    ) {
      const aggregatedStatus = this.locationService.calculateAggregatedStatus(
        locationStatuses,
        locationConfig,
      );
      overallStatus =
        aggregatedStatus === 'partial' ? 'down' : aggregatedStatus;

      this.logger.debug(
        `Aggregated status for monitor ${monitorId}: ${aggregatedStatus} (${Object.values(locationStatuses).filter(Boolean).length}/${results.length} locations up)`,
      );
    } else {
      // Single location mode - use the first result
      overallStatus = results[0].isUp ? 'up' : 'down';
    }

    // Update monitor status with aggregated result
    const previousStatus = monitor.status;
    const checkedAt = results[0].checkedAt;

    await this.updateMonitorStatus(monitorId, overallStatus, checkedAt);

    // Handle alerts based on aggregated status using consolidated alert logic
    const currentStatus = overallStatus;
    if (previousStatus !== currentStatus) {
      this.logger.log(
        `Monitor ${monitorId} status changed: ${previousStatus} -> ${currentStatus}`,
      );

      // Calculate location summary for alert reason
      const downCount = results.filter((r) => !r.isUp).length;
      const upCount = results.length - downCount;
      const reason =
        currentStatus === 'down'
          ? `Monitor is down in ${downCount}/${results.length} locations`
          : `Monitor has recovered (${upCount}/${results.length} locations up)`;

      const avgResponseTime =
        results.reduce((sum, r) => sum + (r.responseTimeMs || 0), 0) /
        results.length;

      // Use consolidated alert evaluation method
      await this.evaluateAndSendAlert({
        monitorId,
        monitor,
        previousStatus,
        currentStatus,
        reason,
        metadata: {
          responseTime: avgResponseTime,
          locationResults: results.map((r) => ({
            location: r.location,
            isUp: r.isUp,
            responseTime: r.responseTimeMs,
          })),
        },
      });
    }
  }

  async saveDistributedMonitorResult(
    result: MonitorExecutionResult,
    options: {
      executionGroupId?: string;
      expectedLocations?: MonitoringLocation[];
    },
  ): Promise<void> {
    const executionGroupId = options.executionGroupId;
    const expectedLocations =
      options.expectedLocations && options.expectedLocations.length > 0
        ? Array.from(new Set(options.expectedLocations))
        : undefined;

    const persistedResult: MonitorExecutionResult =
      executionGroupId || expectedLocations
        ? {
            ...result,
            details: {
              ...(result.details ?? {}),
              ...(executionGroupId ? { executionGroupId } : {}),
              ...(expectedLocations ? { expectedLocations } : {}),
            },
          }
        : result;

    await this.saveMonitorResultToDb(persistedResult);

    if (!executionGroupId) {
      await this.saveMonitorResults([persistedResult], { persisted: true });
      return;
    }

    const monitor = await this.getMonitorById(result.monitorId);
    if (!monitor) {
      return;
    }

    const monitorConfig = monitor.config ?? null;
    const locationConfig = monitorConfig?.locationConfig ?? null;
    const expected =
      expectedLocations && expectedLocations.length > 0
        ? expectedLocations
        : this.locationService.getEffectiveLocations(locationConfig);

    // Use Redis for aggregation coordination instead of polling the database
    // This is much more efficient: O(1) Redis ops vs expensive JSON field queries
    const redisKey = `${REDIS_AGGREGATION_KEY_PREFIX}${executionGroupId}`;
    const redis = this.redisService.getClient();

    // Add current location to the Redis set for this execution group
    await redis.sadd(redisKey, result.location);
    await redis.expire(redisKey, REDIS_AGGREGATION_TTL_SECONDS);

    // Check if all locations have reported using Redis (O(1) operation)
    const reportedCount = await redis.scard(redisKey);

    if (reportedCount < expected.length) {
      // Not all locations have reported yet - let the last worker handle aggregation
      this.logger.debug(
        `Location ${result.location} reported for monitor ${result.monitorId}. ` +
          `Waiting for others: ${reportedCount}/${expected.length}. ` +
          `ExecutionGroupId: ${executionGroupId}`,
      );
      return;
    }

    // All locations reported! This worker will aggregate.
    // Brief pause to ensure all DB writes have committed before querying
    await new Promise((resolve) =>
      setTimeout(resolve, MonitorService.AGGREGATION_RETRY_DELAY_MS),
    );

    // Define the type for the rows we're selecting
    type MonitorResultRow = {
      monitorId: string;
      location: string;
      status: string;
      checkedAt: Date;
      responseTimeMs: number | null;
      details: unknown;
      isUp: boolean;
      testExecutionId: string | null;
      testReportS3Url: string | null;
    };

    // Now fetch results from DB (single query, not in a loop)
    const groupRows = await this.dbService.db
      .select({
        monitorId: schema.monitorResults.monitorId,
        location: schema.monitorResults.location,
        status: schema.monitorResults.status,
        checkedAt: schema.monitorResults.checkedAt,
        responseTimeMs: schema.monitorResults.responseTimeMs,
        details: schema.monitorResults.details,
        isUp: schema.monitorResults.isUp,
        testExecutionId: schema.monitorResults.testExecutionId,
        testReportS3Url: schema.monitorResults.testReportS3Url,
      })
      .from(schema.monitorResults)
      .where(
        and(
          eq(schema.monitorResults.monitorId, result.monitorId),
          eq(schema.monitorResults.executionGroupId, executionGroupId),
        ),
      )
      .orderBy(desc(schema.monitorResults.checkedAt));

    // Build map of latest results by location
    const latestByLocation = new Map<MonitoringLocation, MonitorResultRow>();
    for (const row of groupRows) {
      const rowLocation = row.location as MonitoringLocation;
      if (!latestByLocation.has(rowLocation)) {
        latestByLocation.set(rowLocation, row as MonitorResultRow);
      }
    }

    // Clean up Redis key now that we've aggregated
    await redis.del(redisKey);

    if (latestByLocation.size < expected.length) {
      this.logger.warn(
        `Redis reported all locations but DB query found fewer. ` +
          `Expected: ${expected.join(', ')}. ` +
          `Got: ${Array.from(latestByLocation.keys()).join(', ')}. ` +
          `ExecutionGroupId: ${executionGroupId}`,
      );
      return;
    }

    this.logger.log(
      `All locations reported for monitor ${result.monitorId}. Aggregating results...`,
    );

    const aggregatedResults: MonitorExecutionResult[] = expected
      .map((location) => latestByLocation.get(location))
      .filter(
        (
          row,
        ): row is MonitorResultRow & {
          location: MonitoringLocation;
        } => Boolean(row),
      )
      .map((row) => ({
        monitorId: row.monitorId,
        location: row.location as MonitoringLocation,
        status: row.status as MonitorResultStatus,
        checkedAt: row.checkedAt,
        responseTimeMs: row.responseTimeMs ?? undefined,
        details: (row.details as MonitorResultDetails) ?? undefined,
        isUp: row.isUp,
        testExecutionId: row.testExecutionId ?? undefined,
        testReportS3Url: row.testReportS3Url ?? undefined,
      }));

    if (aggregatedResults.length === 0) {
      return;
    }

    this.logger.log(
      `Calling saveMonitorResults for monitor ${result.monitorId} with ${aggregatedResults.length} results`,
    );
    await this.saveMonitorResults(aggregatedResults, { persisted: true });
    this.logger.log(
      `Successfully aggregated and saved results for monitor ${result.monitorId}`,
    );
  }

  async saveMonitorResult(resultData: MonitorExecutionResult): Promise<void> {
    try {
      const monitor = await this.getMonitorById(resultData.monitorId);

      if (monitor) {
        const previousStatus = monitor.status;

        await this.saveMonitorResultToDb(resultData);
        await this.updateMonitorStatus(
          resultData.monitorId,
          resultData.isUp ? 'up' : 'down',
          resultData.checkedAt,
        );

        const currentStatus = resultData.isUp ? 'up' : 'down';
        // Status change is only valid if coming from 'up' or 'down' states
        // Ignore transitions from 'pending' or 'paused' as they're not real state changes
        const isStatusChange =
          previousStatus !== currentStatus &&
          previousStatus !== 'paused' &&
          previousStatus !== 'pending';

        // Only log status changes, not every result
        if (isStatusChange) {
          this.logger.log(
            `Monitor ${resultData.monitorId} status changed from ${previousStatus} to ${currentStatus}`,
          );
        }

        // Check alert thresholds on every result when alerts are enabled
        if (monitor.alertConfig?.enabled) {
          this.logger.debug(
            `[ALERT_DEBUG] Checking alert thresholds for monitor ${resultData.monitorId}, currentStatus: ${currentStatus}, previousStatus: ${previousStatus}, isStatusChange: ${isStatusChange}`,
          );

          // Get the latest result we just saved to get accurate consecutive tracking
          const latestResult =
            await this.dbService.db.query.monitorResults.findFirst({
              where: eq(schema.monitorResults.monitorId, resultData.monitorId),
              orderBy: [desc(schema.monitorResults.checkedAt)],
            });

          const alertConfig = monitor.alertConfig;
          const consecutiveFailureCount =
            latestResult?.consecutiveFailureCount || 0;
          const consecutiveSuccessCount =
            latestResult?.consecutiveSuccessCount || 0;
          const alertsSentForFailure = latestResult?.alertsSentForFailure || 0;
          const alertsSentForRecovery =
            latestResult?.alertsSentForRecovery || 0;

          this.logger.debug(
            `[ALERT_DEBUG] Monitor ${resultData.monitorId} - consecutiveFailureCount: ${consecutiveFailureCount}, consecutiveSuccessCount: ${consecutiveSuccessCount}, alertsSentForFailure: ${alertsSentForFailure}, alertsSentForRecovery: ${alertsSentForRecovery}, isStatusChange: ${isStatusChange}`,
          );

          // Determine if we should send alerts
          let shouldSendFailureAlert = false;
          let shouldSendRecoveryAlert = false;

          if (currentStatus === 'down') {
            // Failure alert logic:
            // 1st alert: when consecutive failures reach the threshold
            // 2nd & 3rd alerts: at exponentially increasing intervals to prevent alert flood
            const failureThreshold = alertConfig?.failureThreshold || 1;

            if (consecutiveFailureCount === failureThreshold) {
              // First alert: threshold just reached
              shouldSendFailureAlert =
                alertConfig?.alertOnFailure && alertsSentForFailure === 0;
            } else if (
              consecutiveFailureCount > failureThreshold &&
              alertsSentForFailure < 3
            ) {
              // Subsequent alerts use exponential intervals to prevent alert flood
              // Alert at: threshold, threshold + 5, threshold + 15 (approximately 2x, 4x intervals)
              // This ensures minimum 5 failures between alerts regardless of threshold
              const subsequentInterval = Math.max(5, failureThreshold * 2);
              const failuresAfterThreshold =
                consecutiveFailureCount - failureThreshold;
              const expectedAlerts = Math.floor(
                failuresAfterThreshold / subsequentInterval,
              );
              // Only alert if we've passed a new interval checkpoint
              shouldSendFailureAlert =
                alertConfig?.alertOnFailure &&
                expectedAlerts >= alertsSentForFailure &&
                failuresAfterThreshold % subsequentInterval === 0;
            }
          } else if (currentStatus === 'up' && previousStatus === 'down') {
            // Recovery alert logic:
            // Only send recovery alert when consecutive successes reach the recovery threshold
            // This ensures the monitor is truly stable before alerting recovery
            const recoveryThreshold = alertConfig?.recoveryThreshold || 1;

            if (consecutiveSuccessCount === recoveryThreshold) {
              // First recovery alert: threshold just reached
              shouldSendRecoveryAlert =
                (alertConfig?.alertOnRecovery || false) &&
                alertsSentForRecovery === 0;
            } else if (
              consecutiveSuccessCount > recoveryThreshold &&
              alertsSentForRecovery < 3
            ) {
              // Subsequent recovery alerts use exponential intervals to prevent alert flood
              const subsequentInterval = Math.max(5, recoveryThreshold * 2);
              const successesAfterThreshold =
                consecutiveSuccessCount - recoveryThreshold;
              const expectedAlerts = Math.floor(
                successesAfterThreshold / subsequentInterval,
              );
              // Only alert if we've passed a new interval checkpoint
              shouldSendRecoveryAlert =
                (alertConfig?.alertOnRecovery || false) &&
                expectedAlerts >= alertsSentForRecovery &&
                successesAfterThreshold % subsequentInterval === 0;
            }
          }

          this.logger.debug(
            `[ALERT_DEBUG] Monitor ${resultData.monitorId} - shouldSendFailureAlert: ${shouldSendFailureAlert}, shouldSendRecoveryAlert: ${shouldSendRecoveryAlert}`,
          );

          if (shouldSendFailureAlert || shouldSendRecoveryAlert) {
            const type = currentStatus === 'up' ? 'recovery' : 'failure';
            const reason =
              resultData.details?.errorMessage ||
              (type === 'failure'
                ? 'Monitor is down'
                : 'Monitor has recovered');
            const metadata = {
              responseTime: resultData.responseTimeMs,
              consecutiveFailureCount: consecutiveFailureCount,
              consecutiveSuccessCount: consecutiveSuccessCount,
              alertsSentForFailure: alertsSentForFailure,
              alertsSentForRecovery: alertsSentForRecovery,
              isStatusChange: isStatusChange,
            };

            await this.monitorAlertService.sendNotification(
              resultData.monitorId,
              type,
              reason,
              metadata,
            );

            // Update alert counter for the appropriate alert type
            if (shouldSendFailureAlert && latestResult) {
              await this.dbService.db
                .update(schema.monitorResults)
                .set({ alertsSentForFailure: alertsSentForFailure + 1 })
                .where(eq(schema.monitorResults.id, latestResult.id));
            }

            if (shouldSendRecoveryAlert && latestResult) {
              await this.dbService.db
                .update(schema.monitorResults)
                .set({
                  alertsSentForRecovery: alertsSentForRecovery + 1,
                } as any)
                .where(eq(schema.monitorResults.id, latestResult.id));
            }

            // Only log important alert events
            if (type === 'recovery' || alertsSentForFailure < 2) {
              this.logger.log(
                `Sent ${type} notification for monitor ${resultData.monitorId}`,
              );
            }
          } else if (currentStatus === 'down' && alertsSentForFailure >= 3) {
            this.logger.debug(
              `[ALERT_DEBUG] Skipping failure alert for monitor ${resultData.monitorId} - already sent 3 alerts for this failure sequence`,
            );
          } else if (currentStatus === 'up' && previousStatus === 'down') {
            const recoveryThreshold = alertConfig?.recoveryThreshold || 1;
            if (consecutiveSuccessCount < recoveryThreshold) {
              this.logger.debug(
                `[ALERT_DEBUG] Skipping recovery alert for monitor ${resultData.monitorId} - waiting for ${recoveryThreshold - consecutiveSuccessCount} more consecutive successes (${consecutiveSuccessCount}/${recoveryThreshold})`,
              );
            } else if (alertsSentForRecovery >= 3) {
              this.logger.debug(
                `[ALERT_DEBUG] Skipping recovery alert for monitor ${resultData.monitorId} - already sent 3 alerts for this recovery sequence`,
              );
            }
          }
        }

        // Check for SSL expiration warnings independently of status changes
        // Removed debug logs - only log errors and warnings
        if (
          monitor.alertConfig?.enabled &&
          monitor.alertConfig?.alertOnSslExpiration
        ) {
          await this.checkSslExpirationAlert(resultData, monitor);
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to save result for monitor ${resultData.monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async executeHttpRequest(
    target: string,
    config?: MonitorConfig,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
  }> {
    const operationId = `http_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const errorContext: ErrorContext = {
      monitorType: 'http_request',
      target: target,
      correlationId: operationId,
    };

    try {
      // 🔴 CRITICAL: Enhanced validation with security config
      const securityConfig: SecurityConfig = {
        allowInternalTargets: process.env.ALLOW_INTERNAL_TARGETS === 'true',
        maxStringLength: 2048,
        allowedProtocols: ['http:', 'https:'],
      };

      const urlValidation =
        this.enhancedValidationService.validateAndSanitizeUrl(
          target,
          securityConfig,
        );
      if (!urlValidation.valid) {
        const error = this.errorHandler.createValidationError(
          urlValidation.error || 'Invalid target URL',
          { target, validation: urlValidation },
          errorContext,
        );

        return {
          status: 'error',
          details: {
            errorMessage: error.actionable.userMessage,
            errorType: 'validation_error',
            correlationId: error.correlationId,
          },
          isUp: false,
        };
      }

      const sanitizedTarget = urlValidation.sanitized || target;

      // 🔴 CRITICAL: Validate configuration
      if (config) {
        const configValidation =
          this.enhancedValidationService.validateConfiguration(config);
        if (!configValidation.valid) {
          const error = this.errorHandler.createValidationError(
            configValidation.error || 'Invalid monitor configuration',
            { config, validation: configValidation },
            errorContext,
          );

          return {
            status: 'error',
            details: {
              errorMessage: error.actionable.userMessage,
              errorType: 'validation_error',
              correlationId: error.correlationId,
            },
            isUp: false,
          };
        }
      }

      // 🟡 Execute with resource management
      return await this.resourceManager.executeWithResourceLimits(
        operationId,
        async () =>
          this.performHttpRequest(sanitizedTarget, config, errorContext),
        {
          timeoutMs:
            (config?.timeoutSeconds ?? TIMEOUTS_SECONDS.HTTP_REQUEST_DEFAULT) *
            1000,
          maxMemoryMB: MEMORY_LIMITS.MAX_MEMORY_PER_REQUEST_MB,
        },
      );
    } catch (error) {
      const standardError = this.errorHandler.mapError(error, errorContext);

      return {
        status: 'error',
        details: {
          errorMessage: standardError.actionable.userMessage,
          errorType: 'system_error',
          correlationId: standardError.correlationId,
        },
        isUp: false,
      };
    }
  }

  private async performHttpRequest(
    target: string,
    config?: MonitorConfig,
    errorContext?: ErrorContext,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
  }> {
    // 🔴 CRITICAL: Secure logging - mask sensitive data
    const logConfig = this.credentialSecurityService.maskCredentials({
      target,
      method: config?.method || 'GET',
      hasAuth: !!config?.auth,
      hasHeaders: !!config?.headers,
    });

    this.logger.debug('HTTP Request execution starting:', logConfig);

    let responseTimeMs: number | undefined;
    let details: MonitorResultDetails = {};
    let status: MonitorResultStatus = 'error';
    let isUp = false;

    const timeout = config?.timeoutSeconds
      ? config.timeoutSeconds * 1000
      : TIMEOUTS.HTTP_REQUEST_DEFAULT_MS;
    const httpMethod = (config?.method || 'GET').toUpperCase() as Method;

    // Use high-resolution timer for more accurate timing
    const startTime = process.hrtime.bigint();

    // 🟡 Get connection pool for better resource management
    const url = new URL(target);
    const connectionPool = await this.resourceManager.getConnectionPool(
      url.hostname,
      parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      url.protocol as 'http:' | 'https:',
    );

    const connection = await this.resourceManager.acquireConnection(
      connectionPool.id,
    );

    try {
      // Build request configuration
      const requestConfig: any = {
        method: httpMethod,
        url: target,
        timeout,
        // Default headers with security considerations
        headers: {
          'User-Agent': 'Supercheck-Monitor/1.0',
          Accept: 'application/json, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate',
          Connection: 'keep-alive',
          ...config?.headers,
        },
        // Enable automatic decompression for proper response parsing
        decompress: true,
        // Follow redirects but limit for security
        maxRedirects: SECURITY.MAX_REDIRECTS,
        // Handle various response types - keep as text for consistent keyword searching
        responseType: 'text',
        // Accept all status codes, we'll handle validation
        validateStatus: () => true,
        // Limit response size for memory management
        maxContentLength:
          this.resourceManager.getResourceStats().limits.maxResponseSizeMB *
          1024 *
          1024,
        maxBodyLength:
          this.resourceManager.getResourceStats().limits.maxResponseSizeMB *
          1024 *
          1024,
      };

      // 🔴 CRITICAL: Secure authentication handling
      if (config?.auth && config.auth.type !== 'none') {
        // Create credential object for secure handling
        const credentialData: CredentialData = {
          type: config.auth.type,
          username: config.auth.username,
          password: config.auth.password,
          token: config.auth.token,
        };

        // Validate credential strength
        const credentialValidation =
          this.credentialSecurityService.validateCredentialStrength(
            credentialData,
          );
        if (!credentialValidation.valid) {
          this.logger.warn(
            'Weak credential detected for HTTP request:',
            credentialValidation.warnings,
          );
        }

        if (
          config.auth.type === 'basic' &&
          config.auth.username &&
          config.auth.password
        ) {
          requestConfig.auth = {
            username: config.auth.username,
            password: config.auth.password,
          };

          // Secure logging
          this.logger.debug(
            `Using Basic authentication for user: ${this.credentialSecurityService.maskCredentials(config.auth.username)}`,
          );
        } else if (config.auth.type === 'bearer' && config.auth.token) {
          requestConfig.headers['Authorization'] =
            `Bearer ${config.auth.token}`;

          // Secure logging
          this.logger.debug(
            `Using Bearer authentication with token: ${this.credentialSecurityService.maskCredentials(config.auth.token)}`,
          );
        } else {
          this.logger.warn(
            `Invalid auth configuration: type=${config.auth.type}, has credentials=${!!(config.auth.username || config.auth.token)}`,
          );
        }
      }

      // Handle request body for methods that support it
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod) &&
        config?.body
      ) {
        // Helper function to check if header exists (case-insensitive)
        const getHeaderValue = (headerName: string): string | undefined => {
          const lowerHeaderName = headerName.toLowerCase();
          const headers = requestConfig.headers;
          for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === lowerHeaderName) {
              return value as string;
            }
          }
          return undefined;
        };

        // Set content type if not already set
        const existingContentType = getHeaderValue('Content-Type');
        if (!existingContentType) {
          // Try to detect content type
          try {
            JSON.parse(config.body);
            requestConfig.headers['Content-Type'] = 'application/json';
          } catch {
            requestConfig.headers['Content-Type'] = 'text/plain';
          }
        }

        // Attempt to parse body as JSON if content type suggests it, otherwise send as is
        const contentType = getHeaderValue('Content-Type') || '';
        if (contentType.includes('application/json')) {
          try {
            requestConfig.data = JSON.parse(config.body);
          } catch {
            // If JSON parsing fails but content type is JSON, still send as string
            requestConfig.data = config.body;
          }
        } else {
          requestConfig.data = config.body;
        }
      }

      // Execute request with connection tracking
      const response = await firstValueFrom(
        this.httpService.request(requestConfig),
      );

      // Calculate response time in milliseconds with high precision
      const endTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

      // Track connection usage
      connection.trackRequest(responseTimeMs);

      // 🔴 CRITICAL: Sanitize response data before processing
      const sanitizedResponseData =
        this.credentialSecurityService.maskCredentials(
          typeof response.data === 'string'
            ? response.data.substring(
                0,
                MEMORY_LIMITS.MAX_SANITIZED_RESPONSE_LENGTH,
              )
            : String(response.data).substring(
                0,
                MEMORY_LIMITS.MAX_SANITIZED_RESPONSE_LENGTH,
              ),
        );

      details = {
        statusCode: response.status,
        statusText: response.statusText,
        responseHeaders: response.headers as Record<string, string>,
        responseSize: response.data ? JSON.stringify(response.data).length : 0,
      };

      if (isExpectedStatus(response.status, config?.expectedStatusCodes)) {
        status = 'up';
        isUp = true;

        if (config?.keywordInBody) {
          // Ensure we have a string to search in
          let bodyString: string;
          if (typeof response.data === 'string') {
            bodyString = response.data;
          } else if (response.data && typeof response.data === 'object') {
            bodyString = JSON.stringify(response.data);
          } else {
            bodyString = String(response.data || '');
          }

          // Perform case-insensitive keyword matching for better reliability
          const keyword = config.keywordInBody;
          const keywordFound = bodyString
            .toLowerCase()
            .includes(keyword.toLowerCase());

          // Store sanitized response for debugging (security improvement)
          details.responseBodySnippet = sanitizeResponseBody(
            bodyString,
            MEMORY_LIMITS.RESPONSE_BODY_SNIPPET_LENGTH,
          );

          this.logger.debug(
            `Keyword search: looking for '${keyword}' in response body (${bodyString.length} chars): found=${keywordFound}`,
          );

          if (
            (config.keywordInBodyShouldBePresent === undefined ||
              config.keywordInBodyShouldBePresent === true) &&
            !keywordFound
          ) {
            status = 'down';
            isUp = false;
            details.errorMessage = `Keyword '${keyword}' not found in response body. Response: ${details.responseBodySnippet}`;
          } else if (
            config.keywordInBodyShouldBePresent === false &&
            keywordFound
          ) {
            status = 'down';
            isUp = false;
            details.errorMessage = `Keyword '${keyword}' was found in response but should be absent. Response: ${details.responseBodySnippet}`;
          }
        }
      } else {
        status = 'down';
        isUp = false;
        details.errorMessage = `Received status code: ${response.status}, expected: ${config?.expectedStatusCodes || '200-299'}`;
      }
    } catch (error) {
      // Calculate response time even for errors to track timeout scenarios
      const errorTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(errorTime - startTime) / 1000000);

      if (error instanceof AxiosError) {
        this.logger.warn(
          `HTTP Request to ${target} failed: ${getErrorMessage(error)}`,
        );
        details.errorMessage = getErrorMessage(error);
        if (error.response) {
          details.statusCode = error.response.status;
          details.statusText = error.response.statusText;
        }
        if (
          error.code === 'ECONNABORTED' ||
          getErrorMessage(error).toLowerCase().includes('timeout')
        ) {
          status = 'timeout';
          isUp = false;
          // Keep the actual measured time, don't override with timeout value
          // responseTimeMs already calculated above from startTime
        } else {
          // Check if the received status is unexpected, even on an AxiosError path
          if (
            error.response &&
            !isExpectedStatus(
              error.response.status,
              config?.expectedStatusCodes,
            )
          ) {
            status = 'down';
            details.errorMessage = details.errorMessage
              ? `${details.errorMessage}. `
              : '';
            details.errorMessage += `Received status code: ${error.response.status}, expected: ${config?.expectedStatusCodes || '200-299'}`;
          } else if (!error.response) {
            // Network error, no response from server
            status = 'down'; // Or 'error' as per preference
          }
          isUp = false;
        }
      } else {
        this.logger.error(
          `Unexpected error during HTTP Request to ${target}: ${getErrorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        details.errorMessage =
          getErrorMessage(error) || 'An unexpected error occurred';
        status = 'error';
        isUp = false;
        // Keep the actual measured time for unexpected errors
        // responseTimeMs already calculated above from startTime
      }
    } finally {
      // 🔴 CRITICAL: Always release the connection to prevent connection leaks
      await this.resourceManager.releaseConnection(connectionPool.id, connection);
    }

    this.logger.debug(
      `HTTP Request completed: ${target}, Status: ${status}, Response Time: ${responseTimeMs}ms`,
    );
    return { status, details, responseTimeMs, isUp };
  }

  private async executePingHost(
    target: string,
    config?: MonitorConfig,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
  }> {
    // Validate target to prevent command injection
    const validation = validatePingTarget(target);
    if (!validation.valid) {
      return {
        status: 'error',
        details: {
          errorMessage: validation.error,
          errorType: 'validation_error',
        },
        isUp: false,
      };
    }

    const timeout =
      (config?.timeoutSeconds ?? TIMEOUTS_SECONDS.PING_HOST_DEFAULT) * 1000;
    this.logger.debug(`Ping Host: ${target}, Timeout: ${timeout}ms`);

    const startTime = process.hrtime.bigint();
    let status: MonitorResultStatus = 'error';
    let details: MonitorResultDetails = {};
    let isUp = false;
    let responseTimeMs: number | undefined;

    try {
      // Use TCP connectivity check instead of system ping command
      // This avoids EPERM errors from spawning the ping binary without CAP_NET_RAW
      // We'll attempt to connect to common ports (443 first, then 80)
      const { createConnection } = await import('net');

      const tcpPorts = [443, 80];
      let connected = false;
      let lastError: Error | null = null;

      for (const port of tcpPorts) {
        try {
          await new Promise<void>((resolve, reject) => {
            const socket = createConnection({
              host: target,
              port: port,
              timeout: timeout,
            });

            const timeoutHandle = setTimeout(() => {
              socket.destroy();
              reject(new Error(`Connection timeout on port ${port}`));
            }, timeout);

            socket.on('connect', () => {
              clearTimeout(timeoutHandle);
              socket.destroy();
              connected = true;
              resolve();
            });

            socket.on('error', (error) => {
              clearTimeout(timeoutHandle);
              reject(error);
            });
          });

          // If connection successful, break out of loop
          if (connected) {
            break;
          }
        } catch (portError) {
          lastError = portError as Error;
          // Try next port
          continue;
        }
      }

      const endTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

      if (connected) {
        status = 'up';
        isUp = true;
        details = {
          responseTimeMs: responseTimeMs,
          connectionMethod: 'tcp',
          message: `Host is reachable via TCP on port 443 or 80`,
        };
      } else {
        status = 'down';
        isUp = false;
        details = {
          errorMessage: lastError
            ? `Host unreachable: ${getErrorMessage(lastError)}`
            : 'Host unreachable on common ports (443, 80)',
          connectionMethod: 'tcp',
          responseTimeMs,
        };
      }
    } catch (error) {
      const errorTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(errorTime - startTime) / 1000000);

      this.logger.warn(`Ping to ${target} failed: ${getErrorMessage(error)}`);

      if (getErrorMessage(error).includes('timeout')) {
        status = 'timeout';
        details.errorMessage = `Host unreachable - timeout after ${timeout}ms`;
      } else {
        status = 'error';
        details.errorMessage = getErrorMessage(error);
      }

      isUp = false;
      details.responseTimeMs = responseTimeMs;
    }

    this.logger.debug(
      `Ping completed: ${target}, Status: ${status}, Response Time: ${responseTimeMs}ms`,
    );
    return { status, details, responseTimeMs, isUp };
  }

  private async executePortCheck(
    target: string,
    config?: MonitorConfig,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
  }> {
    const port = config?.port;
    const protocol = (config?.protocol || 'tcp').toLowerCase();
    const expectClosed = config?.expectClosed === true; // When true, success = port is closed
    const timeout =
      (config?.timeoutSeconds ?? TIMEOUTS_SECONDS.PORT_CHECK_DEFAULT) * 1000;

    if (!port) {
      return {
        status: 'error',
        isUp: false,
        details: { errorMessage: 'Port not provided for port_check' },
      };
    }

    // Validate target, port, and protocol
    const validation = validatePortCheckTarget(target, port, protocol);
    if (!validation.valid) {
      return {
        status: 'error',
        details: {
          errorMessage: validation.error,
          errorType: 'validation_error',
        },
        isUp: false,
      };
    }

    this.logger.debug(
      `Port Check: ${target}, Port: ${port}, Protocol: ${protocol}, ExpectClosed: ${expectClosed}, Timeout: ${timeout}ms`,
    );

    const startTime = process.hrtime.bigint();
    let status: MonitorResultStatus = 'error';
    let details: MonitorResultDetails = {};
    let isUp = false;
    let responseTimeMs: number | undefined;

    try {
      if (protocol === 'tcp') {
        // TCP port check using net module
        const net = await import('net');

        await new Promise<void>((resolve, reject) => {
          const socket = new net.Socket();

          const timeoutHandle = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Connection timeout after ${timeout}ms`));
          }, timeout);

          socket.connect(port, target, () => {
            clearTimeout(timeoutHandle);
            socket.destroy();
            resolve();
          });

          socket.on('error', (error) => {
            clearTimeout(timeoutHandle);
            socket.destroy();
            reject(error);
          });
        });

        // If we reach here, connection was successful (port is open)
        const endTime = process.hrtime.bigint();
        responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

        if (expectClosed) {
          // Port was expected to be closed, but it's open - this is a failure
          status = 'down';
          isUp = false;
          details = {
            port,
            protocol,
            connectionSuccessful: true,
            responseTimeMs,
            expectClosed: true,
            errorMessage: 'Port is open but was expected to be closed',
          };
        } else {
          // Normal behavior - open port is success
          status = 'up';
          isUp = true;
          details = {
            port,
            protocol,
            connectionSuccessful: true,
            responseTimeMs,
          };
        }
      } else if (protocol === 'udp') {
        // UDP port check using dgram module
        const dgram = await import('dgram');
        const net = await import('net');

        // Determine socket type based on IP version
        const isIPv6 = net.isIPv6(target);
        const socketType = isIPv6 ? 'udp6' : 'udp4';

        await new Promise<void>((resolve, reject) => {
          const client = dgram.createSocket(socketType);
          let isResolved = false;

          const timeoutHandle = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              client.close(() => {
                // For UDP, timeout doesn't necessarily mean the port is closed
                // UDP is connectionless, so we assume it's reachable if no ICMP error
                // However, this is inherently unreliable for UDP
                resolve();
              });
            }
          }, timeout);

          // Send a small test packet
          const message = Buffer.from('ping');

          client.send(message, port, target, (error) => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeoutHandle);
              client.close(() => {
                if (error) {
                  reject(error);
                } else {
                  // For UDP, successful send usually means the port is reachable
                  // (unless we get an ICMP port unreachable, which would trigger an error)
                  resolve();
                }
              });
            }
          });

          client.on('error', (error) => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeoutHandle);
              client.close(() => {
                reject(error);
              });
            }
          });
        });

        // If we reach here, UDP send was successful (port appears open)
        const endTime = process.hrtime.bigint();
        responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

        if (expectClosed) {
          // Port was expected to be closed, but it appears open - this is a failure
          status = 'down';
          isUp = false;
          details = {
            port,
            protocol,
            packetSent: true,
            responseTimeMs,
            expectClosed: true,
            errorMessage: 'Port appears open but was expected to be closed',
            note: "UDP packet sent successfully. Note: UDP checks are inherently unreliable.",
          };
        } else {
          // Normal behavior - open port is success
          status = 'up';
          isUp = true;
          details = {
            port,
            protocol,
            packetSent: true,
            responseTimeMs,
            note: "UDP packet sent successfully. Note: UDP checks are inherently unreliable - no response doesn't guarantee the port is closed.",
            warning:
              'UDP monitoring has limitations - consider using TCP where possible',
          };
        }
      }
    } catch (error) {
      const endTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

      this.logger.warn(
        `Port Check to ${target}:${port} (${protocol}) failed: ${getErrorMessage(error)}`,
      );

      if (getErrorMessage(error).includes('timeout')) {
        status = 'timeout';
        details.errorMessage = `Connection timeout after ${timeout}ms`;
        isUp = false; // Timeout is failure regardless of expectClosed
      } else if (error.code === 'ECONNREFUSED') {
        if (expectClosed) {
          // Port is closed as expected - this is SUCCESS!
          status = 'up';
          isUp = true;
          details.connectionRefused = true;
          details.expectClosed = true;
          // Clear error message since this is expected behavior
          delete details.errorMessage;
        } else {
          // Normal behavior - connection refused is failure
          status = 'down';
          isUp = false;
          details.errorMessage =
            'Connection refused - port is closed or service not running';
        }
      } else if (error.code === 'EHOSTUNREACH') {
        status = 'down';
        details.errorMessage = 'Host unreachable';
        isUp = false;
      } else if (error.code === 'ENETUNREACH') {
        status = 'down';
        details.errorMessage = 'Network unreachable';
        isUp = false;
      } else {
        status = 'error';
        details.errorMessage = getErrorMessage(error);
        isUp = false;
      }

      // Only set isUp = false if not already set by expectClosed logic above
      // (this line is moved inside each branch now)
      details.port = port;
      details.protocol = protocol;
      details.responseTimeMs = responseTimeMs;
    }

    this.logger.debug(
      `Port Check completed: ${target}:${port} (${protocol}), Status: ${status}, Response Time: ${responseTimeMs}ms`,
    );
    return { status, details, responseTimeMs, isUp };
  }

  private async executeSslCheck(
    target: string,
    config?: MonitorConfig,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
  }> {
    const timeout =
      (config?.timeoutSeconds ?? TIMEOUTS_SECONDS.SSL_CHECK_DEFAULT) * 1000;
    const daysUntilExpirationWarning =
      config?.daysUntilExpirationWarning ?? SECURITY.SSL_DEFAULT_WARNING_DAYS;

    this.logger.debug(
      `SSL Check: ${target}, Timeout: ${timeout}ms, Warning threshold: ${daysUntilExpirationWarning} days`,
    );

    const startTime = process.hrtime.bigint();
    let status: MonitorResultStatus = 'error';
    let details: MonitorResultDetails = {};
    let isUp = false;
    let responseTimeMs: number | undefined;

    try {
      const tls = await import('tls');
      const { URL } = await import('url');

      // Parse target to extract hostname and port
      let hostname = target;
      let port = 443; // Default HTTPS port

      try {
        // Try to parse as URL first
        const url = new URL(
          target.startsWith('http') ? target : `https://${target}`,
        );
        hostname = url.hostname;
        port = parseInt(url.port) || 443;
      } catch {
        // If URL parsing fails, treat as hostname:port format
        const parts = target.split(':');
        hostname = parts[0];
        if (parts[1]) {
          port = parseInt(parts[1]);
        }
      }

      const certificateInfo = await new Promise<{
        certificate: any;
        authorized: boolean;
        authorizationError?: Error;
      }>((resolve, reject) => {
        let isResolved = false;

        const socket = tls.connect(
          {
            host: hostname,
            port: port,
            rejectUnauthorized: false, // Allow connection to inspect invalid/expired certificates
            servername: hostname, // SNI support for proper certificate validation
            secureProtocol: 'TLS_method', // Use modern TLS
            // Don't set socket timeout here to avoid dual timeout issue
          },
          () => {
            if (!isResolved) {
              isResolved = true;
              const cert = socket.getPeerCertificate(true);
              const authorized = socket.authorized;
              const authorizationError = socket.authorizationError;

              clearTimeout(timeoutHandle);
              socket.destroy();
              resolve({
                certificate: cert,
                authorized,
                authorizationError,
              });
            }
          },
        );

        // Single timeout mechanism to avoid conflicts
        const timeoutHandle = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            socket.destroy();
            reject(new Error(`SSL connection timeout after ${timeout}ms`));
          }
        }, timeout);

        socket.on('error', (error) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutHandle);
            socket.destroy();
            reject(error);
          }
        });
      });

      const endTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

      const cert = certificateInfo.certificate;

      if (!cert || !cert.valid_from || !cert.valid_to) {
        status = 'error';
        isUp = false;
        details = {
          errorMessage: 'No valid certificate found',
          responseTimeMs,
        };
      } else {
        const validFrom = new Date(cert.valid_from);
        const validTo = new Date(cert.valid_to);
        const now = new Date();

        // Improved days remaining calculation accounting for timezone and precision
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysRemaining = Math.ceil(
          (validTo.getTime() - now.getTime()) / msPerDay,
        );

        // SSL certificate information (compatible with schema)
        const sslCertificate = {
          valid: certificateInfo.authorized,
          issuer: cert.issuer?.CN || 'Unknown',
          subject: cert.subject?.CN || 'Unknown',
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysRemaining: daysRemaining,
          serialNumber: cert.serialNumber,
          fingerprint: cert.fingerprint,
          // Additional info for debugging (as part of details)
          ...(cert.issuerCertificate && { hasIssuerCert: true }),
          ...(cert.subjectaltname && { altNames: cert.subjectaltname }),
          ...(certificateInfo.authorizationError && {
            authError: certificateInfo.authorizationError.message,
          }),
        };

        // Determine status based on certificate validity
        if (now < validFrom) {
          status = 'error';
          isUp = false;
          details = {
            errorMessage: 'Certificate is not yet valid',
            sslCertificate,
            responseTimeMs,
          };
        } else if (now > validTo) {
          status = 'down';
          isUp = false;
          details = {
            errorMessage: 'Certificate has expired',
            sslCertificate,
            responseTimeMs,
          };
        } else if (daysRemaining <= daysUntilExpirationWarning) {
          status = 'up'; // Still up but warning
          isUp = true;
          details = {
            warningMessage: `Certificate expires in ${daysRemaining} days`,
            sslCertificate,
            responseTimeMs,
          };
        } else {
          status = 'up';
          isUp = true;
          details = {
            sslCertificate,
            responseTimeMs,
          };
        }

        // Add authorization details
        if (!certificateInfo.authorized && certificateInfo.authorizationError) {
          details.authorizationError =
            certificateInfo.authorizationError.message;
        }
      }
    } catch (error) {
      const endTime = process.hrtime.bigint();
      responseTimeMs = Math.round(Number(endTime - startTime) / 1000000);

      this.logger.warn(
        `SSL Check to ${target} failed: ${getErrorMessage(error)}`,
      );

      if (getErrorMessage(error).includes('timeout')) {
        status = 'timeout';
        details.errorMessage = `SSL connection timeout after ${timeout}ms`;
      } else if (error.code === 'ECONNREFUSED') {
        status = 'down';
        details.errorMessage = 'Connection refused - SSL service not available';
      } else if (error.code === 'EHOSTUNREACH') {
        status = 'down';
        details.errorMessage = 'Host unreachable';
      } else if (error.code === 'ENOTFOUND') {
        status = 'down';
        details.errorMessage = 'Host not found';
      } else if (getErrorMessage(error).includes('handshake')) {
        status = 'down';
        details.errorMessage =
          'SSL handshake failed - certificate or TLS configuration issue';
      } else if (getErrorMessage(error).includes('alert')) {
        status = 'down';
        details.errorMessage =
          'SSL/TLS protocol error - server rejected connection';
      } else if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
        status = 'down';
        details.errorMessage = 'Self-signed certificate';
      } else if (error.code === 'CERT_HAS_EXPIRED') {
        status = 'down';
        details.errorMessage = 'Certificate has expired';
      } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        status = 'down';
        details.errorMessage = 'Unable to verify certificate signature';
      } else {
        status = 'error';
        details.errorMessage = `SSL check failed: ${getErrorMessage(error)}`;
      }

      isUp = false;
      details.responseTimeMs = responseTimeMs;
    }

    this.logger.debug(
      `SSL Check completed: ${target}, Status: ${status}, Response Time: ${responseTimeMs}ms`,
    );
    return { status, details, responseTimeMs, isUp };
  }

  async getMonitorById(monitorId: string): Promise<Monitor | undefined> {
    return this.dbService.db.query.monitors.findFirst({
      where: (monitors, { eq }) => eq(monitors.id, monitorId),
    }) as Promise<Monitor | undefined>;
  }

  /**
   * Determines if SSL check should be performed based on smart frequency logic
   */
  private async shouldPerformSslCheck(
    monitorId: string,
    config?: any,
  ): Promise<boolean> {
    try {
      // Get current monitor config from database to check SSL last checked timestamp
      const monitor = await this.dbService.db.query.monitors.findFirst({
        where: (monitors, { eq }) => eq(monitors.id, monitorId),
      });

      if (!monitor || !monitor.config) {
        return true; // First time check
      }

      const monitorConfig = monitor.config as any;
      const sslLastCheckedAt = monitorConfig.sslLastCheckedAt;
      const sslCheckFrequencyHours =
        config?.sslCheckFrequencyHours ??
        monitorConfig.sslCheckFrequencyHours ??
        SECURITY.SSL_CHECK_FREQUENCY_HOURS;
      const sslDaysUntilExpirationWarning =
        config?.sslDaysUntilExpirationWarning ??
        monitorConfig.sslDaysUntilExpirationWarning ??
        SECURITY.SSL_DEFAULT_WARNING_DAYS;

      if (!sslLastCheckedAt) {
        return true; // Never checked before
      }

      const lastChecked = new Date(sslLastCheckedAt);
      const now = new Date();
      const hoursSinceLastCheck =
        (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);

      // Check if we have SSL certificate info to determine smart frequency
      const sslCertificate =
        monitorConfig.sslCertificate || (monitor.config as any)?.sslCertificate;
      if (sslCertificate && sslCertificate.daysRemaining !== undefined) {
        // Smart frequency: check more often when approaching expiration
        if (sslCertificate.daysRemaining <= sslDaysUntilExpirationWarning) {
          // Check every hour when within warning threshold
          return hoursSinceLastCheck >= 1;
        }
        if (sslCertificate.daysRemaining <= sslDaysUntilExpirationWarning * 2) {
          // Check every 6 hours when within 2x warning threshold
          return hoursSinceLastCheck >= 6;
        }
      }

      // Default frequency check
      return hoursSinceLastCheck >= sslCheckFrequencyHours;
    } catch (error) {
      this.logger.error(
        `Error checking SSL frequency for monitor ${monitorId}:`,
        error,
      );
      return true; // Default to checking on error
    }
  }

  /**
   * Updates the SSL last checked timestamp in monitor config
   */
  private async updateSslLastChecked(monitorId: string): Promise<void> {
    try {
      const monitor = await this.dbService.db.query.monitors.findFirst({
        where: (monitors, { eq }) => eq(monitors.id, monitorId),
      });

      if (!monitor) {
        return;
      }

      const updatedConfig = {
        ...((monitor.config as any) || {}),
        sslLastCheckedAt: new Date().toISOString(),
      };

      await this.dbService.db
        .update(schema.monitors)
        .set({ config: updatedConfig })
        .where(eq(schema.monitors.id, monitorId));
    } catch (error) {
      this.logger.error(
        `Error updating SSL last checked for monitor ${monitorId}:`,
        error,
      );
    }
  }

  /**
   * Checks for SSL expiration warnings and sends alerts independently of status changes
   */
  private async checkSslExpirationAlert(
    resultData: MonitorExecutionResult,
    monitor: any,
  ): Promise<void> {
    try {
      // Removed debug log

      // Check if SSL certificate info is available and has warning
      const sslCertificate = resultData.details?.sslCertificate;
      const sslWarning =
        resultData.details?.sslWarning || resultData.details?.warningMessage;

      // Removed debug logs

      if (!sslCertificate && !sslWarning) {
        return; // No SSL info to check
      }

      let shouldAlert = false;
      let alertReason = '';

      // Check for SSL expiration warning
      if (sslCertificate?.daysRemaining !== undefined) {
        const daysUntilExpiration = sslCertificate.daysRemaining;
        const warningThreshold =
          monitor.config?.sslDaysUntilExpirationWarning ??
          SECURITY.SSL_DEFAULT_WARNING_DAYS;

        // Removed debug logs

        if (
          daysUntilExpiration <= warningThreshold &&
          daysUntilExpiration > 0
        ) {
          shouldAlert = true;
          alertReason = `SSL certificate expires in ${daysUntilExpiration} days`;
        } else if (daysUntilExpiration <= 0) {
          shouldAlert = true;
          alertReason = 'SSL certificate has expired';
        }
      }

      // Check for SSL warning messages
      if (sslWarning && typeof sslWarning === 'string') {
        shouldAlert = true;
        alertReason = alertReason || sslWarning;
      }

      if (shouldAlert) {
        // Check if we've already sent an SSL alert recently to avoid spam
        const lastSslAlert = await this.getLastSslAlert(resultData.monitorId);
        const now = new Date();
        const hoursSinceLastAlert = lastSslAlert
          ? (now.getTime() - lastSslAlert.getTime()) / (1000 * 60 * 60)
          : Infinity;

        // Only send SSL alerts once per day to avoid spam
        if (hoursSinceLastAlert >= 24) {
          await this.monitorAlertService.sendSslExpirationNotification(
            resultData.monitorId,
            alertReason,
            {
              sslCertificate,
              daysRemaining: sslCertificate?.daysRemaining,
              responseTime: resultData.responseTimeMs,
            },
          );

          // Record that we sent an SSL alert
          await this.recordSslAlert(resultData.monitorId);

          // Only log important SSL alerts
          this.logger.log(
            `Sent SSL expiration alert for monitor ${resultData.monitorId}: ${alertReason}`,
          );
        }
        // Removed debug log for skipped alerts
      }
    } catch (error) {
      this.logger.error(
        `Error checking SSL expiration alert for monitor ${resultData.monitorId}:`,
        error,
      );
    }
  }

  /**
   * Gets the timestamp of the last SSL alert sent for a monitor
   */
  private async getLastSslAlert(monitorId: string): Promise<Date | null> {
    try {
      const lastAlert = await this.dbService.db.query.alertHistory.findFirst({
        where: (alertHistory, { eq, and }) =>
          and(
            eq(alertHistory.monitorId, monitorId),
            eq(alertHistory.type, 'ssl_expiring'),
          ),
        orderBy: (alertHistory, { desc }) => [desc(alertHistory.sentAt)],
      });

      return lastAlert?.sentAt ? new Date(lastAlert.sentAt) : null;
    } catch (error) {
      this.logger.error(
        `Error getting last SSL alert for monitor ${monitorId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Records that an SSL alert was sent for a monitor
   */
  private async recordSslAlert(monitorId: string): Promise<void> {
    try {
      const monitor = await this.dbService.db.query.monitors.findFirst({
        where: (monitors, { eq }) => eq(monitors.id, monitorId),
      });

      if (!monitor) {
        return;
      }

      const updatedConfig = {
        ...((monitor.config as any) || {}),
        lastSslAlertSentAt: new Date().toISOString(),
      };

      await this.dbService.db
        .update(schema.monitors)
        .set({ config: updatedConfig })
        .where(eq(schema.monitors.id, monitorId));
    } catch (error) {
      this.logger.error(
        `Error recording SSL alert for monitor ${monitorId}:`,
        error,
      );
    }
  }

  private async saveMonitorResultToDb(
    resultData: MonitorExecutionResult,
  ): Promise<void> {
    try {
      // Get the last monitor result to track consecutive failures and successes
      const lastResult = await this.dbService.db.query.monitorResults.findFirst(
        {
          where: eq(schema.monitorResults.monitorId, resultData.monitorId),
          orderBy: [desc(schema.monitorResults.checkedAt)],
        },
      );

      let consecutiveFailureCount = 0;
      let consecutiveSuccessCount = 0;
      let alertsSentForFailure = 0;
      let alertsSentForRecovery = 0;

      // Calculate consecutive failure and success counts
      if (!resultData.isUp) {
        // Monitor is down - track failure sequence
        if (lastResult && !lastResult.isUp) {
          // Continue failure sequence
          consecutiveFailureCount =
            (lastResult.consecutiveFailureCount || 0) + 1;
          alertsSentForFailure = lastResult.alertsSentForFailure || 0;
        } else {
          // Start new failure sequence
          consecutiveFailureCount = 1;
          alertsSentForFailure = 0;
        }
        // Reset success counters when down
        consecutiveSuccessCount = 0;
        alertsSentForRecovery = 0;
      } else {
        // Monitor is up - track success sequence
        if (lastResult && lastResult.isUp) {
          // Continue success sequence
          consecutiveSuccessCount =
            (lastResult.consecutiveSuccessCount || 0) + 1;
          alertsSentForRecovery = lastResult.alertsSentForRecovery || 0;
        } else {
          // Start new success sequence (just recovered)
          consecutiveSuccessCount = 1;
          alertsSentForRecovery = 0;
        }
        // Reset failure counters when up
        consecutiveFailureCount = 0;
        alertsSentForFailure = 0;
      }

      // Determine if this is a status change
      const isStatusChange = lastResult
        ? lastResult.isUp !== resultData.isUp
        : true;

      // Log synthetic monitor metadata before saving
      if (resultData.testExecutionId) {
        this.logger.log(
          `Saving monitor result with testExecutionId: ${resultData.testExecutionId}, testReportS3Url: ${resultData.testReportS3Url}`,
        );
      }

      await this.dbService.db.insert(schema.monitorResults).values({
        monitorId: resultData.monitorId,
        location: resultData.location,
        checkedAt: resultData.checkedAt,
        status: resultData.status,
        responseTimeMs: resultData.responseTimeMs,
        details: resultData.details,
        isUp: resultData.isUp,
        isStatusChange: isStatusChange,
        consecutiveFailureCount: consecutiveFailureCount,
        consecutiveSuccessCount: consecutiveSuccessCount,
        alertsSentForFailure: alertsSentForFailure,
        alertsSentForRecovery: alertsSentForRecovery,
        // Store test execution metadata for synthetic monitors
        testExecutionId: resultData.testExecutionId || null,
        testReportS3Url: resultData.testReportS3Url || null,
        // PERFORMANCE: Store executionGroupId as first-class column for indexed lookups
        executionGroupId:
          (resultData.details as { executionGroupId?: string })?.executionGroupId || null,
      });
    } catch (error) {
      this.logger.error(
        `Failed to save monitor result for ${resultData.monitorId}: ${getErrorMessage(error)}`,
      );
    }
  }

  private async updateMonitorStatus(
    monitorId: string,
    status: 'up' | 'down',
    checkedAt: Date,
  ): Promise<void> {
    try {
      // Get current monitor status before update to detect status changes
      const currentMonitor = await this.getMonitorById(monitorId);
      const previousStatus = currentMonitor?.status;

      // Determine if this is a status change
      const isStatusChange = previousStatus && previousStatus !== status;

      await this.dbService.db
        .update(schema.monitors)
        .set({
          status: status,
          lastCheckAt: checkedAt,
          lastStatusChangeAt: isStatusChange ? checkedAt : undefined,
        })
        .where(eq(schema.monitors.id, monitorId));

      this.logger.log(
        `Updated monitor ${monitorId} status: ${previousStatus || 'unknown'} -> ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update monitor status for ${monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Evaluate and send alerts based on status transitions.
   * Consolidated alert logic for both single and multi-location monitors.
   * Prevents unnecessary alerts on initial monitor creation (pending → any status).
   *
   * @returns Alert action metadata { alertSent: boolean, alertType?: string, alertsSentCount?: number }
   */
  private async evaluateAndSendAlert(options: {
    monitorId: string;
    monitor: Awaited<ReturnType<typeof this.getMonitorById>>;
    previousStatus: string;
    currentStatus: 'up' | 'down';
    reason: string;
    metadata: Record<string, unknown>;
  }): Promise<{ alertSent: boolean; alertType?: string }> {
    const {
      monitorId,
      monitor,
      previousStatus,
      currentStatus,
      reason,
      metadata,
    } = options;

    // Don't send alerts if alerts are disabled
    if (!monitor?.alertConfig?.enabled) {
      return { alertSent: false };
    }

    // Don't send alerts for state transitions from 'pending' or 'paused'
    // These are initial states and should not trigger notifications
    if (previousStatus === 'pending' || previousStatus === 'paused') {
      this.logger.debug(
        `[ALERT] Skipping alert for monitor ${monitorId}: transitioning from ${previousStatus} status (not a real state change)`,
      );
      return { alertSent: false };
    }

    // Only process if there's an actual status change
    if (previousStatus === currentStatus) {
      return { alertSent: false };
    }

    const alertConfig = monitor.alertConfig;

    // Determine alert type based on status transition
    let shouldSendAlert = false;
    let alertType: 'recovery' | 'failure' | null = null;

    if (currentStatus === 'up' && previousStatus === 'down') {
      // Recovery: only alert when status changes from 'down' to 'up'
      shouldSendAlert = alertConfig?.alertOnRecovery || false;
      alertType = 'recovery';
    } else if (currentStatus === 'down' && previousStatus === 'up') {
      // Failure: only alert when status changes from 'up' to 'down'
      shouldSendAlert = alertConfig?.alertOnFailure || false;
      alertType = 'failure';
    } else if (currentStatus === 'down') {
      // Monitor is down but wasn't from 'up' state
      // This handles case where previous state was something other than 'up'/'down'
      // (e.g., initial check that failed). Don't alert in this case.
      this.logger.debug(
        `[ALERT] Not alerting for monitor ${monitorId}: first failure detected (previous status: ${previousStatus})`,
      );
      return { alertSent: false };
    }

    if (!shouldSendAlert || !alertType) {
      return { alertSent: false };
    }

    try {
      this.logger.log(
        `Sending ${alertType} notification for monitor ${monitorId}`,
      );

      await this.monitorAlertService.sendNotification(
        monitorId,
        alertType,
        reason,
        metadata,
      );

      return { alertSent: true, alertType };
    } catch (error) {
      this.logger.error(
        `Failed to send ${alertType} alert for monitor ${monitorId}: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { alertSent: false };
    }
  }

  /**
   * Get recent monitor results for threshold checking
   */
  private async getRecentMonitorResults(
    monitorId: string,
    limit: number,
  ): Promise<MonitorResult[]> {
    try {
      const results = await this.dbService.db.query.monitorResults.findMany({
        where: eq(schema.monitorResults.monitorId, monitorId),
        orderBy: [desc(schema.monitorResults.checkedAt)],
        limit: limit,
      });
      return (results || []) as MonitorResult[];
    } catch (error) {
      this.logger.error(
        `Failed to get recent monitor results: ${getErrorMessage(error)}`,
      );
      return [];
    }
  }

  /**
   * Execute a synthetic test monitor by running a Playwright test
   * This method bridges the monitoring system with the test execution infrastructure
   *
   * @param monitorId The monitor ID for logging and tracking
   * @param config Monitor configuration containing testId and Playwright options
   * @returns Monitor execution result with status, details, and response time
   */
  private async executeSyntheticTest(
    monitorId: string,
    config?: MonitorConfig,
  ): Promise<{
    status: MonitorResultStatus;
    details: MonitorResultDetails;
    responseTimeMs?: number;
    isUp: boolean;
    testExecutionId?: string;
    testReportS3Url?: string;
  }> {
    const startTime = Date.now();

    try {
      // 1. Validate configuration
      if (!config?.testId) {
        this.logger.error(
          `[${monitorId}] Synthetic monitor missing testId in configuration`,
        );
        return {
          status: 'error',
          details: {
            errorMessage:
              'No testId configured for synthetic monitor. Please check monitor configuration.',
          },
          isUp: false,
          responseTimeMs: Date.now() - startTime,
        };
      }

      this.logger.log(
        `[${monitorId}] Executing synthetic test: ${config.testId}`,
      );

      // 2. Fetch test from database
      const testId = config.testId;
      const test = await this.dbService.getTestById(testId);

      if (!test) {
        this.logger.error(
          `[${monitorId}] Test ${config.testId} not found in database`,
        );
        return {
          status: 'error',
          details: {
            errorMessage: `Test not found (ID: ${config.testId}). The test may have been deleted.`,
          },
          isUp: false,
          responseTimeMs: Date.now() - startTime,
        };
      }

      // 3. Decode test script (stored as Base64 in database)
      let decodedScript: string;
      try {
        decodedScript = Buffer.from(test.script, 'base64').toString('utf8');

        // Validate decoded script is not empty
        if (!decodedScript || decodedScript.trim().length === 0) {
          throw new Error('Decoded script is empty');
        }

        this.logger.debug(
          `[${monitorId}] Successfully decoded test script for: ${test.title}`,
        );
      } catch (decodeError) {
        this.logger.error(
          `[${monitorId}] Failed to decode test script: ${getErrorMessage(decodeError)}`,
        );
        return {
          status: 'error',
          details: {
            errorMessage: `Failed to decode test script: ${getErrorMessage(decodeError)}`,
          },
          isUp: false,
          responseTimeMs: Date.now() - startTime,
        };
      }

      // 4. Execute test using existing ExecutionService
      this.logger.log(
        `[${monitorId}] Executing Playwright test: ${test.title}`,
      );

      const testResult = await this.executionService.runSingleTest(
        {
          testId: test.id,
          code: decodedScript,
        },
        true,
        true,
      ); // Bypass concurrency check and use unique execution IDs for monitor executions

      // Use actual test execution time if available, otherwise fall back to total time
      const responseTimeMs =
        testResult.executionTimeMs ?? Date.now() - startTime;

      // 5. Track Playwright usage for billing (synthetic monitors count as Playwright execution)
      const monitor = await this.dbService.db.query.monitors.findFirst({
        where: (monitors, { eq }) => eq(monitors.id, monitorId),
      });

      if (monitor?.organizationId) {
        await this.usageTrackerService
          .trackPlaywrightExecution(monitor.organizationId, responseTimeMs, {
            monitorId,
            testId: test.id,
            type: 'synthetic_monitor',
          })
          .catch((err: Error) =>
            this.logger.warn(
              `[${monitorId}] Failed to track Playwright usage for synthetic test: ${err.message}`,
            ),
          );
      }

      // 6. Convert test result to monitor result format
      if (testResult.success) {
        this.logger.log(
          `[${monitorId}] Synthetic test passed: ${test.title} (${responseTimeMs}ms)`,
        );
        this.logger.log(
          `[${monitorId}] Test execution metadata: testId=${testResult.testId}, reportUrl=${testResult.reportUrl}`,
        );

        return {
          status: 'up',
          details: {
            testTitle: test.title,
            testType: test.type,
            reportUrl: testResult.reportUrl || undefined,
            message: 'Test execution successful',
            // Truncate logs for storage efficiency
            executionSummary: testResult.stdout?.substring(0, 500),
          },
          responseTimeMs,
          isUp: true,
          // Store test execution metadata for report access
          testExecutionId: testResult.testId,
          testReportS3Url: testResult.reportUrl || undefined,
        };
      } else {
        this.logger.warn(
          `[${monitorId}] Synthetic test failed: ${test.title} - ${testResult.error}`,
        );

        return {
          status: 'down',
          details: {
            testTitle: test.title,
            testType: test.type,
            errorMessage: testResult.error || 'Test execution failed',
            reportUrl: testResult.reportUrl || undefined,
            // Truncate logs for storage efficiency
            executionSummary: testResult.stdout?.substring(0, 500),
            executionErrors: testResult.stderr?.substring(0, 500),
          },
          responseTimeMs,
          isUp: false,
          // Store test execution metadata for report access
          testExecutionId: testResult.testId,
          testReportS3Url: testResult.reportUrl || undefined,
        };
      }
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      this.logger.error(
        `[${monitorId}] Synthetic test execution failed: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        status: 'error',
        details: {
          errorMessage: `Synthetic test execution error: ${getErrorMessage(error)}`,
          errorType: 'execution_error',
        },
        responseTimeMs,
        isUp: false,
      };
    }
  }
}

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema'; // Import the schema we copied
import {
  reports,
  jobs,
  runs,
  JobStatus,
  TestRunStatus,
  alertHistory,
  AlertType,
  AlertStatus,
} from '../../db/schema'; // Specifically import reports table
import { eq, and, sql, desc } from 'drizzle-orm';
import { ReportMetadata } from '../interfaces'; // Import our interface
import { NotificationProvider } from '../../notification/notification.service';
import { decryptNotificationProviderConfig } from '../../common/notification-provider-crypto';

// Define a token for the Drizzle provider
export const DB_PROVIDER_TOKEN = 'DB_DRIZZLE';

@Injectable()
export class DbService implements OnModuleInit {
  private readonly logger = new Logger(DbService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private dbInstance: PostgresJsDatabase<typeof schema>,
    private configService: ConfigService,
  ) {
    this.logger.log('Drizzle ORM initialized.');
  }

  onModuleInit() {
    // Optional: Test connection on startup
    try {
      this.dbInstance.select({ now: sql`now()` });
      this.logger.log('Database connection successful.');
    } catch (error) {
      const errorToLog =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error('Database connection failed!', errorToLog);
    }
  }

  get db(): PostgresJsDatabase<typeof schema> {
    return this.dbInstance;
  }

  /**
   * Stores or updates report metadata in the database.
   * Adapt based on ReportMetadata interface.
   */
  async storeReportMetadata(metadata: ReportMetadata): Promise<void> {
    const { entityId, entityType, reportPath, status, s3Url } = metadata;
    this.logger.debug(
      `Storing report metadata for ${entityType}/${entityId} with status ${status}`,
    );

    try {
      const existing = await this.db
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.entityId, entityId),
            eq(reports.entityType, entityType),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        this.logger.debug(
          `Updating existing report metadata for ${entityType}/${entityId}`,
        );
        await this.db
          .update(reports)
          .set({
            reportPath, // This is likely the S3 key now
            status,
            s3Url,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reports.entityId, entityId),
              eq(reports.entityType, entityType),
            ),
          )
          .execute();
      } else {
        this.logger.debug(
          `Inserting new report metadata for ${entityType}/${entityId}`,
        );
        await this.db
          .insert(reports)
          .values({
            entityId,
            entityType,
            reportPath, // S3 key
            status,
            s3Url,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }
      this.logger.log(
        `Successfully stored report metadata for ${entityType}/${entityId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error storing report metadata for ${entityType}/${entityId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Decide whether to re-throw or just log
      // throw error;
    }
  }

  /**
   * Updates the status of a job in the jobs table
   * @param jobId The ID of the job to update
   * @param runStatuses Array of run statuses for the job
   */
  async updateJobStatus(
    jobId: string,
    runStatuses: ('pending' | 'running' | 'passed' | 'failed' | 'error')[],
  ): Promise<void> {
    try {
      // Determine the aggregate job status
      let jobStatus: JobStatus;
      if (runStatuses.some((s) => s === 'error')) {
        jobStatus = 'error';
      } else if (runStatuses.some((s) => s === 'failed')) {
        jobStatus = 'failed';
      } else if (runStatuses.some((s) => s === 'running' || s === 'pending')) {
        jobStatus = 'running';
      } else if (runStatuses.every((s) => s === 'passed')) {
        jobStatus = 'passed';
      } else {
        jobStatus = 'passed'; // Default to completed if all runs are done (and not failed)
      }

      this.logger.log(
        `Updating job ${jobId} status based on ${runStatuses.length} runs. Final status: ${jobStatus}`,
      );
      await this.db
        .update(jobs)
        .set({
          status: jobStatus,
        })
        .where(eq(jobs.id, jobId));
    } catch (error) {
      this.logger.error(`Failed to update job status for ${jobId}:`, error);
    }
  }

  /**
   * Updates the status and duration of a run in the runs table
   * @param runId The ID of the run to update
   * @param status The new status to set
   * @param duration The duration of the run (string like "3s" or "1m 30s")
   * @param errorDetails Optional error details to store
   */
  async updateRunStatus(
    runId: string,
    status: TestRunStatus,
    duration?: string,
    errorDetails?: string,
  ): Promise<void> {
    this.logger.debug(
      `Updating run ${runId} with status ${status} and duration ${duration}`,
    );

    try {
      const now = new Date();
      const updateData: {
        status: TestRunStatus;
        durationMs?: number;
        completedAt?: Date;
        startedAt?: Date;
        errorDetails?: string;
        artifactPaths?: any;
      } = {
        status,
      };

      // Add duration if provided - convert string duration to milliseconds
      if (duration) {
        let durationSeconds = 0;

        if (duration.includes('m')) {
          // Format like "1m 30s"
          const minutes = parseInt(duration.split('m')[0].trim(), 10) || 0;
          const secondsMatch = duration.match(/(\d+)s/);
          const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
          durationSeconds = minutes * 60 + seconds;
        } else {
          // Format like "45s" or just number
          const secondsMatch =
            duration.match(/(\d+)s/) || duration.match(/^(\d+)$/);
          durationSeconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;
        }

        // Store duration in milliseconds only
        updateData.durationMs = durationSeconds * 1000;
      }

      // Add completedAt timestamp for terminal statuses
      if (['failed', 'passed', 'error'].includes(status)) {
        updateData.completedAt = now;

        // If no duration provided, calculate from startedAt
        if (!duration) {
          try {
            const existingRun = await this.dbInstance
              .select({ startedAt: runs.startedAt })
              .from(runs)
              .where(eq(runs.id, runId))
              .limit(1);

            if (existingRun.length > 0 && existingRun[0].startedAt) {
              const durationMs =
                now.getTime() - existingRun[0].startedAt.getTime();
              updateData.durationMs = durationMs;
            }
          } catch (e) {
            this.logger.warn(
              `Could not calculate duration for run ${runId}: ${e}`,
            );
          }
        }
      }

      // Add error details if provided
      if (errorDetails) {
        updateData.errorDetails = errorDetails;
      }

      // Update the database
      await this.dbInstance
        .update(runs)
        .set(updateData)
        .where(eq(runs.id, runId));

      this.logger.log(
        `Successfully updated run ${runId} with status ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update run status: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Gets a job by ID including alert configuration with RBAC filtering
   * @param jobId The ID of the job to retrieve
   * @param organizationId The organization ID for RBAC filtering
   * @param projectId The project ID for RBAC filtering
   */
  async getJobById(
    jobId: string,
    organizationId?: string,
    projectId?: string,
  ): Promise<any> {
    try {
      // Build where condition with RBAC filtering if context is provided
      const whereConditions = [eq(schema.jobs.id, jobId)];

      if (organizationId) {
        whereConditions.push(eq(schema.jobs.organizationId, organizationId));
      }
      if (projectId) {
        whereConditions.push(eq(schema.jobs.projectId, projectId));
      }

      const job = await this.db.query.jobs.findFirst({
        where:
          whereConditions.length > 1
            ? and(...whereConditions)
            : whereConditions[0],
      });

      if (!job && (organizationId || projectId)) {
        this.logger.warn(
          `Job ${jobId} not found or access denied for organization ${organizationId}, project ${projectId}`,
        );
        return null;
      }

      return job;
    } catch (error) {
      this.logger.error(
        `Failed to get job ${jobId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Gets the last run for a job
   * @param jobId The ID of the job to get the last run for
   */
  async getLastRunForJob(jobId: string): Promise<any> {
    try {
      const lastRun = await this.db.query.runs.findFirst({
        where: eq(schema.runs.jobId, jobId),
        orderBy: [desc(schema.runs.completedAt)],
      });
      return lastRun;
    } catch (error) {
      this.logger.error(
        `Failed to get last run for job ${jobId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Gets project information by ID
   * @param projectId The project ID
   */
  async getProjectById(projectId: string): Promise<any> {
    try {
      const project = await this.db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });
      return project;
    } catch (error) {
      this.logger.error(
        `Failed to get project ${projectId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Gets notification providers by IDs with RBAC filtering
   * @param providerIds Array of provider IDs
   * @param organizationId The organization ID for RBAC filtering
   * @param projectId The project ID for RBAC filtering
   */
  async getNotificationProviders(
    providerIds: string[],
    organizationId?: string,
    projectId?: string,
  ): Promise<NotificationProvider[]> {
    try {
      if (!providerIds || providerIds.length === 0) {
        return [];
      }

      // Build where conditions with RBAC filtering
      const whereConditions = [
        (notificationProviders: any, { inArray }: any) =>
          inArray(notificationProviders.id, providerIds),
      ];

      if (organizationId) {
        whereConditions.push((notificationProviders: any, { eq }: any) =>
          eq(notificationProviders.organizationId, organizationId),
        );
      }
      if (projectId) {
        whereConditions.push((notificationProviders: any, { eq }: any) =>
          eq(notificationProviders.projectId, projectId),
        );
      }

      whereConditions.push((notificationProviders: any, { eq }: any) =>
        eq(notificationProviders.isEnabled, true),
      );

      const providers = await this.db.query.notificationProviders.findMany({
        where:
          whereConditions.length > 1
            ? (notificationProviders: any, ops: any) =>
                ops.and(
                  ...whereConditions.map((cond: any) =>
                    cond(notificationProviders, ops),
                  ),
                )
            : whereConditions[0],
      });

      this.logger.debug(
        `Found ${providers?.length || 0} notification providers for org ${organizationId}, project ${projectId}`,
      );

      // Map the database result to NotificationProvider interface
      return (providers || []).map((provider) => ({
        id: provider.id,
        type: provider.type,
        config: decryptNotificationProviderConfig(
          provider.config,
          provider.projectId ?? undefined,
        ),
      }));
    } catch (error) {
      this.logger.error(
        `Failed to get notification providers: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Saves an alert history record to the database
   */
  async saveAlertHistory(
    jobId: string,
    type: AlertType,
    provider: string,
    status: AlertStatus,
    message: string,
    errorMessage?: string,
    jobNameOverride?: string,
  ): Promise<void> {
    try {
      let jobName = jobNameOverride;

      if (!jobName) {
        // Get the actual job name - no need for RBAC filtering here since we're just getting the name
        const job = (await this.getJobById(jobId)) as { name?: string } | null;
        jobName = job?.name || `Job ${jobId}`;
      }

      await this.db.insert(alertHistory).values({
        jobId,
        type,
        provider,
        status,
        message,
        sentAt: new Date(),
        errorMessage,
        target: jobName,
        targetType: 'job',
      });

      this.logger.log(
        `Successfully saved alert history for job ${jobId} with status: ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save alert history for job ${jobId}:`,
        error,
      );
      throw new Error('Internal Server Error');
    }
  }

  /**
   * Get recent runs for a job to check alert thresholds
   */
  async getRecentRunsForJob(jobId: string, limit: number = 5) {
    try {
      const runs = await this.db
        .select({
          id: schema.runs.id,
          status: schema.runs.status,
          createdAt: schema.runs.createdAt,
        })
        .from(schema.runs)
        .where(eq(schema.runs.jobId, jobId))
        .orderBy(desc(schema.runs.id)) // UUIDv7 is time-ordered (PostgreSQL 18+)
        .limit(limit);

      return runs;
    } catch (error) {
      this.logger.error(
        `Failed to get recent runs for job ${jobId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  async getRunStatusesForJob(
    jobId: string,
  ): Promise<('pending' | 'running' | 'passed' | 'failed' | 'error')[]> {
    try {
      const result = await this.db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.jobId, jobId));

      return result.map((r) => r.status).filter((s) => s !== null) as (
        | 'pending'
        | 'running'
        | 'passed'
        | 'failed'
        | 'error'
      )[];
    } catch (error) {
      this.logger.error(`Failed to get run statuses for job ${jobId}:`, error);
      return [];
    }
  }

  // ===============================
  // Requirement Coverage Methods
  // ===============================

  /**
   * Get all requirement IDs linked to tests in a job
   * @param jobId The job ID
   * @param organizationId For RBAC filtering
   */
  async getRequirementsByJobTests(
    jobId: string,
    organizationId: string,
  ): Promise<string[]> {
    try {
      // Get tests from job via jobTests, then find linked requirements
      const result = await this.db
        .select({ requirementId: schema.testRequirements.requirementId })
        .from(schema.testRequirements)
        .innerJoin(
          schema.jobTests,
          eq(schema.testRequirements.testId, schema.jobTests.testId),
        )
        .innerJoin(
          schema.requirements,
          eq(schema.testRequirements.requirementId, schema.requirements.id),
        )
        .where(
          and(
            eq(schema.jobTests.jobId, jobId),
            eq(schema.requirements.organizationId, organizationId),
          ),
        );

      // Return unique requirement IDs
      const uniqueIds = [...new Set(result.map((r) => r.requirementId))];
      this.logger.debug(
        `Found ${uniqueIds.length} requirements linked to job ${jobId}`,
      );
      return uniqueIds;
    } catch (error) {
      this.logger.error(
        `Failed to get requirements for job ${jobId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Get all tests linked to a requirement with their latest run status
   * Determines test status by finding the most recent completed job run containing that test
   * @param requirementId The requirement ID
   * @param organizationId For RBAC filtering
   */
  async getLinkedTestsWithStatus(
    requirementId: string,
    _organizationId: string,
  ): Promise<Array<{ testId: string; status: 'passed' | 'failed' | null }>> {
    try {
      // Get all tests linked to this requirement
      const linkedTests = await this.db
        .select({ testId: schema.testRequirements.testId })
        .from(schema.testRequirements)
        .where(eq(schema.testRequirements.requirementId, requirementId));

      if (linkedTests.length === 0) {
        return [];
      }

      // For each test, find the latest completed job run that includes this test
      const results: Array<{ testId: string; status: 'passed' | 'failed' | null }> = [];

      for (const { testId } of linkedTests) {
        // Find jobs that include this test
        const jobsWithTest = await this.db
          .select({ jobId: schema.jobTests.jobId })
          .from(schema.jobTests)
          .where(eq(schema.jobTests.testId, testId));

        if (jobsWithTest.length === 0) {
          results.push({ testId, status: null });
          continue;
        }

        // Get the latest completed run from any of these jobs
        const jobIds = jobsWithTest.map((j) => j.jobId);
        const latestRun = await this.db
          .select({ status: schema.runs.status })
          .from(schema.runs)
          .where(
            and(
              sql`${schema.runs.jobId} IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`,
              sql`${schema.runs.status} IN ('passed', 'failed', 'error')`,
            ),
          )
          .orderBy(desc(schema.runs.completedAt))
          .limit(1);

        const status = latestRun.length > 0 ? latestRun[0].status : null;
        results.push({
          testId,
          status:
            status === 'passed'
              ? 'passed'
              : status === 'failed' || status === 'error'
                ? 'failed'
                : null,
        });
      }

      return results;
    } catch (error) {
      this.logger.error(
        `Failed to get linked tests for requirement ${requirementId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Update requirement coverage snapshot
   * @param requirementId The requirement to update
   * @param organizationId For RBAC (used in logging)
   * @param stats Coverage statistics
   */
  async updateRequirementCoverageSnapshot(
    requirementId: string,
    _organizationId: string,
    stats: {
      status: 'covered' | 'failing' | 'missing';
      linkedTestCount: number;
      passedTestCount: number;
      failedTestCount: number;
      lastFailedTestId?: string;
      lastFailedAt?: Date;
    },
  ): Promise<void> {
    try {
      const now = new Date();

      // Upsert the coverage snapshot
      const existing = await this.db
        .select()
        .from(schema.requirementCoverageSnapshots)
        .where(eq(schema.requirementCoverageSnapshots.requirementId, requirementId))
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(schema.requirementCoverageSnapshots)
          .set({
            status: stats.status,
            linkedTestCount: stats.linkedTestCount,
            passedTestCount: stats.passedTestCount,
            failedTestCount: stats.failedTestCount,
            lastFailedTestId: stats.lastFailedTestId ?? null,
            lastFailedAt: stats.lastFailedAt ?? null,
            lastEvaluatedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.requirementCoverageSnapshots.requirementId, requirementId));
      } else {
        await this.db.insert(schema.requirementCoverageSnapshots).values({
          requirementId,
          status: stats.status,
          linkedTestCount: stats.linkedTestCount,
          passedTestCount: stats.passedTestCount,
          failedTestCount: stats.failedTestCount,
          lastFailedTestId: stats.lastFailedTestId ?? null,
          lastFailedAt: stats.lastFailedAt ?? null,
          lastEvaluatedAt: now,
          updatedAt: now,
        });
      }

      this.logger.debug(
        `Updated coverage for requirement ${requirementId}: ${stats.status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update coverage for requirement ${requirementId}: ${(error as Error).message}`,
      );
      // Don't throw - coverage update failures shouldn't break job completion
    }
  }
}

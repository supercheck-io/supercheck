import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { monitors, monitorNotificationSettings, notificationProviders } from "@/db/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import {
  createMonitorHandler,
  updateMonitorHandler,
} from "@/lib/monitor-service";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  sanitizeString,
  sanitizeUrl,
  sanitizeHostname,
} from "@/lib/input-sanitizer";
import { checkMonitorLimit } from "@/lib/middleware/plan-enforcement";
import { subscriptionService } from "@/lib/services/subscription-service";

export async function GET(request: Request) {
  try {
    // Require authentication and project context
    const context = await requireAuthContext();

    // PERFORMANCE: Use checkPermissionWithContext to avoid 5-8 duplicate DB queries
    const canView = checkPermissionWithContext('monitor', 'view', context);

    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get URL parameters for pagination only (org/project comes from session)
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10),
      100
    );

    // For backward compatibility, if no pagination params are provided, return all
    const usePagination =
      url.searchParams.has("page") || url.searchParams.has("limit");

    // SECURITY: Always filter by org/project from session, never trust client params
    const whereCondition = and(
      eq(monitors.projectId, context.project.id),
      eq(monitors.organizationId, context.organizationId)
    );

    if (usePagination) {
      // Validate pagination parameters
      if (page < 1 || limit < 1) {
        return NextResponse.json(
          {
            error: "Invalid pagination parameters. Page and limit must be >= 1",
          },
          { status: 400 }
        );
      }

      const offset = (page - 1) * limit;

      // Run count and data queries in parallel for better performance
      const [countResult, monitorsList] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(monitors)
          .where(whereCondition),
        db
          .select()
          .from(monitors)
          .where(whereCondition)
          .orderBy(desc(monitors.id))
          .limit(limit)
          .offset(offset),
      ]);

      const total = Number(countResult[0]?.count || 0);

      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        data: monitorsList,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } else {
      // Return monitors with default limit for safety
      // OPTIMIZED: Added default limit to prevent fetching unlimited records
      const DEFAULT_LIMIT = 200;
      const monitorsList = await db
        .select()
        .from(monitors)
        .where(whereCondition)
        .orderBy(desc(monitors.id))
        .limit(DEFAULT_LIMIT);

      // Return standardized response format for React Query hooks
      return NextResponse.json({
        data: monitorsList,
        pagination: {
          total: monitorsList.length,
          page: 1,
          limit: DEFAULT_LIMIT,
          totalPages: 1,
          hasMore: monitorsList.length === DEFAULT_LIMIT, // Indicate if there might be more
        },
      });
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error fetching monitors:", error);
    return NextResponse.json(
      { error: "Failed to fetch monitors" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCtx = await requireAuthContext();
    const { userId, project, organizationId } = authCtx;

    // SECURITY: Rate limiting to prevent API abuse
    const { checkMonitorApiRateLimit } = await import(
      "@/lib/session-security"
    );
    const rateLimitResult = await checkMonitorApiRateLimit(
      userId,
      organizationId,
      "create"
    );
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitResult.retryAfter || 60),
          },
        }
      );
    }

    // SECURITY: Validate subscription before allowing monitor creation
    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);

    const rawData = await req.json();
    console.log("[MONITOR_CREATE] Raw data received:", rawData);

    // Sanitize input data
    rawData.name = sanitizeString(rawData.name);
    if (rawData.target) {
      // Sanitize target based on type
      if (rawData.type === "http_request" || rawData.type === "website") {
        rawData.target = sanitizeUrl(rawData.target);
      } else if (
        rawData.type === "ping_host" ||
        rawData.type === "port_check"
      ) {
        rawData.target = sanitizeHostname(rawData.target);
      } else {
        rawData.target = sanitizeString(rawData.target);
      }
    }

    // Sanitize auth credentials if present
    if (rawData.config?.auth) {
      if (rawData.config.auth.username) {
        rawData.config.auth.username = sanitizeString(
          rawData.config.auth.username
        );
      }
      if (rawData.config.auth.password) {
        rawData.config.auth.password = sanitizeString(
          rawData.config.auth.password
        );
      }
      if (rawData.config.auth.token) {
        rawData.config.auth.token = sanitizeString(rawData.config.auth.token);
      }
    }

    // Sanitize custom message in alertConfig
    if (rawData.alertConfig?.customMessage) {
      rawData.alertConfig.customMessage = sanitizeString(
        rawData.alertConfig.customMessage
      );
    }

    // Special logging for heartbeat monitors
    if (rawData.type === "heartbeat") {
      console.log(
        "[MONITOR_CREATE] Processing heartbeat monitor with config:",
        rawData.config
      );
    }

    // Validate required fields
    if (!rawData.name || !rawData.type) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          details: "name and type are required",
        },
        { status: 400 }
      );
    }

    // Validate frequency bounds (1 minute minimum, 1440 minutes = 24 hours maximum)
    // This prevents resource exhaustion from too-frequent checks and ensures reasonable monitoring intervals
    const MIN_FREQUENCY_MINUTES = 1;
    const MAX_FREQUENCY_MINUTES = 1440; // 24 hours
    
    if (rawData.frequencyMinutes !== undefined) {
      const freq = Number(rawData.frequencyMinutes);
      if (isNaN(freq) || freq < MIN_FREQUENCY_MINUTES || freq > MAX_FREQUENCY_MINUTES) {
        return NextResponse.json(
          {
            error: "Invalid frequency",
            details: `frequencyMinutes must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
          },
          { status: 400 }
        );
      }
    }

    // Validate target - all monitor types require a target except heartbeat and synthetic_test
    if (rawData.type === "synthetic_test") {
      // For synthetic monitors, validate testId in config
      if (!rawData.config?.testId) {
        return NextResponse.json(
          {
            error: "testId is required in config for synthetic monitors",
            details: "Please select a test to monitor",
          },
          { status: 400 }
        );
      }

      // Verify test exists and user has access
      const { tests } = await import("@/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const test = await db.query.tests.findFirst({
        where: and(
          eq(tests.id, rawData.config.testId),
          eq(tests.projectId, project.id),
          eq(tests.organizationId, organizationId)
        ),
        columns: {
          id: true,
          title: true,
          type: true,
        },
      });

      if (!test) {
        return NextResponse.json(
          {
            error: "Test not found or access denied",
            details:
              "The selected test does not exist or you do not have permission to access it",
          },
          { status: 404 }
        );
      }

      // Auto-set target to testId for consistency
      rawData.target = rawData.config.testId;

      // Cache test title in config for display purposes
      if (!rawData.config.testTitle) {
        rawData.config.testTitle = test.title;
      }

      console.log(
        "[MONITOR_CREATE] Creating synthetic monitor for test:",
        test.title
      );
    } else if (rawData.type !== "heartbeat" && !rawData.target) {
      return NextResponse.json(
        { error: "Target is required for this monitor type" },
        { status: 400 }
      );
    }

    // Prepare alert configuration - ensure it's properly structured and saved to alertConfig column
    let alertConfig = null;
    if (rawData.alertConfig) {
      alertConfig = {
        enabled: Boolean(rawData.alertConfig.enabled),
        notificationProviders: Array.isArray(
          rawData.alertConfig.notificationProviders
        )
          ? rawData.alertConfig.notificationProviders
          : [],
        alertOnFailure:
          rawData.alertConfig.alertOnFailure !== undefined
            ? Boolean(rawData.alertConfig.alertOnFailure)
            : true,
        alertOnRecovery:
          rawData.alertConfig.alertOnRecovery !== undefined
            ? Boolean(rawData.alertConfig.alertOnRecovery)
            : true,
        alertOnSslExpiration:
          rawData.alertConfig.alertOnSslExpiration !== undefined
            ? Boolean(rawData.alertConfig.alertOnSslExpiration)
            : false,
        failureThreshold:
          typeof rawData.alertConfig.failureThreshold === "number"
            ? rawData.alertConfig.failureThreshold
            : 1,
        recoveryThreshold:
          typeof rawData.alertConfig.recoveryThreshold === "number"
            ? rawData.alertConfig.recoveryThreshold
            : 1,
        customMessage:
          typeof rawData.alertConfig.customMessage === "string"
            ? rawData.alertConfig.customMessage
            : "",
      };
      console.log("[MONITOR_CREATE] Processed alert config:", alertConfig);
    }

    // Construct the config object (for monitor-specific settings, not alerts)
    const finalConfig = rawData.config || {};
    console.log("[MONITOR_CREATE] Final config:", finalConfig);

    // Use current project context
    const targetProjectId = project.id;

    // Check permission to create monitors
    const canCreate = checkPermissionWithContext("monitor", "create", authCtx);

    if (!canCreate) {
      return NextResponse.json(
        { error: "Insufficient permissions to create monitors" },
        { status: 403 }
      );
    }

    // Check monitor limit for the organization's plan using proper SQL COUNT
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(monitors)
      .where(eq(monitors.organizationId, organizationId));

    const limitCheck = await checkMonitorLimit(
      organizationId,
      Number(countResult[0]?.count || 0)
    );
    if (!limitCheck.allowed) {
      console.warn(
        `Monitor limit reached for organization ${organizationId}: ${limitCheck.error}`
      );
      return NextResponse.json(
        {
          error: limitCheck.error,
          upgrade: limitCheck.upgrade,
          currentPlan: limitCheck.currentPlan,
          limit: limitCheck.limit,
        },
        { status: 403 }
      );
    }

    // Use the monitor service to create the monitor
    const monitorData = {
      name: rawData.name,
      description: rawData.description,
      type: rawData.type,
      target: rawData.target,
      frequencyMinutes: rawData.frequencyMinutes || 5,
      enabled: rawData.enabled !== false, // Default to true
      config: finalConfig,
      alertConfig: alertConfig,
      createdByUserId: userId,
      projectId: targetProjectId,
      organizationId: organizationId,
    };

    // Validate alert configuration if enabled
    if (alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !alertConfig.notificationProviders ||
        alertConfig.notificationProviders.length === 0
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }

      // Check notification channel limit
      const maxMonitorChannels = parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (alertConfig.notificationProviders.length > maxMonitorChannels) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxMonitorChannels} notification channels`,
          },
          { status: 400 }
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }
    }

    const newMonitor = await createMonitorHandler(monitorData);

    // Link notification providers if alert config is enabled
    if (
      newMonitor &&
      alertConfig?.enabled &&
      Array.isArray(alertConfig.notificationProviders) &&
      alertConfig.notificationProviders.length > 0
    ) {
      // SECURITY: Validate that all notification providers belong to the same org/project
      const validProviders = await db
        .select({ id: notificationProviders.id })
        .from(notificationProviders)
        .where(
          and(
            inArray(notificationProviders.id, alertConfig.notificationProviders),
            eq(notificationProviders.organizationId, organizationId),
            eq(notificationProviders.projectId, targetProjectId)
          )
        );

      const validProviderIds = new Set(validProviders.map((p) => p.id));
      const invalidProviderIds = alertConfig.notificationProviders.filter(
        (id: string) => !validProviderIds.has(id)
      );

      if (invalidProviderIds.length > 0) {
        console.warn(
          `[MONITOR_CREATE] Skipping ${invalidProviderIds.length} invalid/unauthorized notification provider(s)`
        );
      }

      if (validProviderIds.size > 0) {
        const normalizedProviderIds = Array.from(validProviderIds);

        console.log(
          "[MONITOR_CREATE] Linking notification providers:",
          normalizedProviderIds
        );

        await db
          .insert(monitorNotificationSettings)
          .values(
            normalizedProviderIds.map((providerId) => ({
              monitorId: newMonitor.id,
              notificationProviderId: providerId,
            }))
          )
          .onConflictDoNothing();
      }
    }

    // Log the audit event for monitor creation
    await logAuditEvent({
      userId,
      organizationId,
      action: "monitor_created",
      resource: "monitor",
      resourceId: newMonitor.id,
      metadata: {
        monitorName: monitorData.name,
        monitorType: monitorData.type,
        target: monitorData.target,
        frequencyMinutes: monitorData.frequencyMinutes,
        projectId: project.id,
        projectName: project.name,
        alertsEnabled: alertConfig?.enabled || false,
        notificationProvidersCount:
          alertConfig?.notificationProviders?.length || 0,
      },
      success: true,
    });

    console.log(
      "[MONITOR_CREATE] Successfully created monitor:",
      newMonitor.id
    );
    return NextResponse.json(newMonitor, { status: 201 });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[MONITOR_CREATE] Error creating monitor:", error);
    return NextResponse.json(
      { error: "Failed to create monitor" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const putCtx = await requireAuthContext();
    const { userId, project, organizationId } = putCtx;

    const rawData = await req.json();
    const { id, ...updateData } = rawData;

    if (!id) {
      return NextResponse.json(
        { error: "Monitor ID is required" },
        { status: 400 }
      );
    }

    // Verify monitor belongs to current project context
    const monitorData = await db
      .select({
        projectId: monitors.projectId,
        organizationId: monitors.organizationId,
      })
      .from(monitors)
      .where(
        and(
          eq(monitors.id, id),
          eq(monitors.projectId, project.id),
          eq(monitors.organizationId, organizationId)
        )
      )
      .limit(1);

    if (monitorData.length === 0) {
      return NextResponse.json(
        { error: "Monitor not found or access denied" },
        { status: 404 }
      );
    }

    // Check permission to manage monitors
    const canManage = checkPermissionWithContext("monitor", "manage", putCtx);

    if (!canManage) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitors" },
        { status: 403 }
      );
    }

    // Validate frequency bounds (1 minute minimum, 1440 minutes = 24 hours maximum)
    const MIN_FREQUENCY_MINUTES = 1;
    const MAX_FREQUENCY_MINUTES = 1440; // 24 hours
    
    if (rawData.frequencyMinutes !== undefined) {
      const freq = Number(rawData.frequencyMinutes);
      if (isNaN(freq) || freq < MIN_FREQUENCY_MINUTES || freq > MAX_FREQUENCY_MINUTES) {
        return NextResponse.json(
          {
            error: "Invalid frequency",
            details: `frequencyMinutes must be between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`,
          },
          { status: 400 }
        );
      }
    }

    // Validate synthetic test monitor updates
    if (rawData.type === "synthetic_test" && rawData.config?.testId) {
      const { tests } = await import("@/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const test = await db.query.tests.findFirst({
        where: and(
          eq(tests.id, rawData.config.testId),
          eq(tests.projectId, project.id),
          eq(tests.organizationId, organizationId)
        ),
        columns: {
          id: true,
          title: true,
          type: true,
        },
      });

      if (!test) {
        return NextResponse.json(
          {
            error: "Test not found or access denied",
            details:
              "The selected test does not exist or you do not have permission to access it",
          },
          { status: 404 }
        );
      }

      // Update cached test title
      if (!rawData.config.testTitle) {
        rawData.config.testTitle = test.title;
      }

      console.log(
        "[MONITOR_UPDATE] Updating synthetic monitor for test:",
        test.title
      );
    }

    // Prepare alert configuration - ensure it's properly structured
    let alertConfig = null;
    if (rawData.alertConfig) {
      alertConfig = {
        enabled: Boolean(rawData.alertConfig.enabled),
        notificationProviders: Array.isArray(
          rawData.alertConfig.notificationProviders
        )
          ? rawData.alertConfig.notificationProviders
          : [],
        alertOnFailure:
          rawData.alertConfig.alertOnFailure !== undefined
            ? Boolean(rawData.alertConfig.alertOnFailure)
            : true,
        alertOnRecovery:
          rawData.alertConfig.alertOnRecovery !== undefined
            ? Boolean(rawData.alertConfig.alertOnRecovery)
            : true,
        alertOnSslExpiration:
          rawData.alertConfig.alertOnSslExpiration !== undefined
            ? Boolean(rawData.alertConfig.alertOnSslExpiration)
            : false,
        failureThreshold:
          typeof rawData.alertConfig.failureThreshold === "number"
            ? rawData.alertConfig.failureThreshold
            : 1,
        recoveryThreshold:
          typeof rawData.alertConfig.recoveryThreshold === "number"
            ? rawData.alertConfig.recoveryThreshold
            : 1,
        customMessage:
          typeof rawData.alertConfig.customMessage === "string"
            ? rawData.alertConfig.customMessage
            : "",
      };
    }

    // Use the monitor service to update the monitor
    const monitorUpdateData = {
      name: updateData.name,
      description: updateData.description,
      type: updateData.type,
      target: updateData.target,
      frequencyMinutes: updateData.frequencyMinutes,
      enabled: updateData.enabled,
      config: updateData.config,
      alertConfig: alertConfig,
    };

    // Validate alert configuration if enabled
    if (alertConfig?.enabled) {
      // Check if at least one notification provider is selected
      if (
        !alertConfig.notificationProviders ||
        alertConfig.notificationProviders.length === 0
      ) {
        return NextResponse.json(
          {
            error:
              "At least one notification channel must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }

      // Check notification channel limit
      const maxMonitorChannels = parseInt(
        process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10",
        10
      );
      if (alertConfig.notificationProviders.length > maxMonitorChannels) {
        return NextResponse.json(
          {
            error: `You can only select up to ${maxMonitorChannels} notification channels`,
          },
          { status: 400 }
        );
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        return NextResponse.json(
          {
            error:
              "At least one alert type must be selected when alerts are enabled",
          },
          { status: 400 }
        );
      }
    }

    const updatedMonitor = await updateMonitorHandler(id, monitorUpdateData);

    // Update notification provider links if alert config is enabled
    if (
      updatedMonitor &&
      alertConfig?.enabled &&
      Array.isArray(alertConfig.notificationProviders)
    ) {
      // First, delete existing links
      await db
        .delete(monitorNotificationSettings)
        .where(eq(monitorNotificationSettings.monitorId, id));

      // SECURITY: Validate that all notification providers belong to the same org/project
      if (alertConfig.notificationProviders.length > 0) {
        const validProviders = await db
          .select({ id: notificationProviders.id })
          .from(notificationProviders)
          .where(
            and(
              inArray(notificationProviders.id, alertConfig.notificationProviders),
              eq(notificationProviders.organizationId, organizationId),
              eq(notificationProviders.projectId, project.id)
            )
          );

        const validProviderIds = validProviders.map((p) => p.id);

        // Then, create new links only for validated providers
        if (validProviderIds.length > 0) {
          await db
            .insert(monitorNotificationSettings)
            .values(
              validProviderIds.map((providerId) => ({
                monitorId: id,
                notificationProviderId: providerId,
              }))
            )
            .onConflictDoNothing();
        }
      }
    }

    // Log the audit event for monitor update
    await logAuditEvent({
      userId,
      organizationId,
      action: "monitor_updated",
      resource: "monitor",
      resourceId: id,
      metadata: {
        monitorName: monitorUpdateData.name,
        monitorType: monitorUpdateData.type,
        target: monitorUpdateData.target,
        frequencyMinutes: monitorUpdateData.frequencyMinutes,
        enabled: monitorUpdateData.enabled,
        projectId: project.id,
        projectName: project.name,
        alertsEnabled: alertConfig?.enabled || false,
        notificationProvidersCount:
          alertConfig?.notificationProviders?.length || 0,
      },
      success: true,
    });

    return NextResponse.json(updatedMonitor);
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error updating monitor:", error);
    return NextResponse.json(
      { error: "Failed to update monitor" },
      { status: 500 }
    );
  }
}

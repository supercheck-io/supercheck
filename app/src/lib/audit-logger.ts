/**
 * Audit Logger
 *
 * This module provides comprehensive audit logging for security events,
 * permission checks, and administrative actions.
 */

import { db } from "@/utils/db";
import {
  auditLogs as audit_log,
  user,
  // organization,
  // projects,
  // tests,
  // jobs,
  // monitors,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { headers } from "next/headers";

export interface AuditEvent {
  userId?: string;
  organizationId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  success: boolean;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    // Get request context if available (skip if outside request scope)
    let ipAddress = "unknown";
    let userAgent = "unknown";

    try {
      const headersList = await headers();
      ipAddress =
        headersList.get("x-forwarded-for") ||
        headersList.get("x-real-ip") ||
        "unknown";
      userAgent = headersList.get("user-agent") || "unknown";
    } catch {
      // Running outside request context (e.g., scripts, background jobs)
      // Use provided values or defaults
      ipAddress = event.ipAddress || "script/background";
      userAgent = event.userAgent || "system";
    }

    // Prepare audit log entry according to schema
    const auditEntry = {
      userId: event.userId || null,
      organizationId: (event.metadata?.organizationId as string) || null,
      action: event.action,
      details: {
        resource: event.resource,
        resourceId: event.resourceId || undefined,
        success: event.success,
        ipAddress: event.ipAddress || ipAddress,
        userAgent: event.userAgent || userAgent,
        ...event.metadata,
      },
    };

    // Insert into database
    await db.insert(audit_log).values(auditEntry);

    // Also log to console for immediate visibility in development
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[AUDIT] ${event.success ? "✓" : "✗"} ${event.action} on ${
          event.resource
        }`,
        {
          userId: event.userId,
          success: event.success,
          metadata: event.metadata,
        }
      );
    }
  } catch (error) {
    // Never fail the request due to audit logging errors
    console.error("Failed to log audit event:", error);
  }
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  userId: string,
  action:
    | "login"
    | "logout"
    | "login_failed"
    | "impersonation_start"
    | "impersonation_end",
  success: boolean,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    userId,
    action,
    resource: "authentication",
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success,
  });
}

/**
 * Log impersonation events (alias for logAuthEvent with impersonation actions)
 */
export async function logImpersonationEvent(
  adminUserId: string,
  targetUserId: string,
  action: "start" | "stop",
  metadata?: Record<string, unknown>
): Promise<void> {
  const actionType =
    action === "start" ? "impersonation_start" : "impersonation_end";

  await logAuditEvent({
    userId: adminUserId,
    action: actionType,
    resource: "authentication",
    resourceId: targetUserId,
    metadata: {
      targetUserId,
      adminUserId,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success: true,
  });
}

/**
 * Log permission check events
 */
export async function logPermissionEvent(
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  success: boolean,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    userId,
    action: `permission_${action}`,
    resource,
    resourceId,
    metadata: {
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success,
  });
}

/**
 * Log administrative actions
 */
export async function logAdminEvent(
  userId: string,
  action: string,
  targetUserId?: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    userId,
    action: `admin_${action}`,
    resource: resourceType || "system",
    resourceId,
    metadata: {
      targetUserId,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success: true, // Admin actions that reach here are assumed successful
  });
}

/**
 * Log data access events (especially for sensitive data)
 */
export async function logDataAccess(
  userId: string,
  action: "view" | "export" | "download",
  resourceType: string,
  resourceId: string,
  isSensitive: boolean = false,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    userId,
    action: `data_${action}`,
    resource: resourceType,
    resourceId,
    metadata: {
      isSensitive,
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success: true,
  });
}

/**
 * Log security events
 */
export async function logSecurityEvent(
  action:
    | "rate_limit_exceeded"
    | "unauthorized_access_attempt"
    | "suspicious_activity"
    | "security_violation",
  userId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    userId,
    action,
    resource: "security",
    metadata: {
      severity: action === "security_violation" ? "high" : "medium",
      ...metadata,
      timestamp: new Date().toISOString(),
    },
    success: false, // Security events are typically negative
  });
}

/**
 * Get audit logs for a user
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 100,
  offset: number = 0
): Promise<Array<Record<string, unknown>>> {
  try {
    const logs = await db
      .select({
        id: audit_log.id,
        action: audit_log.action,
        details: audit_log.details,
        createdAt: audit_log.createdAt,
      })
      .from(audit_log)
      .where(eq(audit_log.userId, userId))
      .orderBy(desc(audit_log.createdAt))
      .limit(limit)
      .offset(offset);

    return logs;
  } catch (error) {
    console.error("Failed to get user audit logs:", error);
    return [];
  }
}

/**
 * Get audit logs for a resource
 */
export async function getResourceAuditLogs(
  resourceType: string,
  resourceId: string,
  limit: number = 100,
  offset: number = 0
): Promise<Array<Record<string, unknown>>> {
  try {
    const logs = await db
      .select({
        id: audit_log.id,
        userId: audit_log.userId,
        action: audit_log.action,
        details: audit_log.details,
        createdAt: audit_log.createdAt,
        userName: user.name,
      })
      .from(audit_log)
      .leftJoin(user, eq(audit_log.userId, user.id))
      .where(
        and(
          sql`${audit_log.details}->>'resource' = ${resourceType}`,
          sql`${audit_log.details}->>'resourceId' = ${resourceId}`
        )
      )
      .orderBy(desc(audit_log.createdAt))
      .limit(limit)
      .offset(offset);

    return logs;
  } catch (error) {
    console.error("Failed to get resource audit logs:", error);
    return [];
  }
}

/**
 * Get security events (failed logins, unauthorized access, etc.)
 */
export async function getSecurityEvents(
  limit: number = 100,
  offset: number = 0
): Promise<Array<Record<string, unknown>>> {
  try {
    const whereCondition = sql`${audit_log.details}->>'resource' = 'security'`;

    const logs = await db
      .select({
        id: audit_log.id,
        userId: audit_log.userId,
        action: audit_log.action,
        details: audit_log.details,
        createdAt: audit_log.createdAt,
        userName: user.name,
      })
      .from(audit_log)
      .leftJoin(user, eq(audit_log.userId, user.id))
      .where(whereCondition)
      .orderBy(desc(audit_log.createdAt))
      .limit(limit)
      .offset(offset);

    return logs;
  } catch (error) {
    console.error("Failed to get security events:", error);
    return [];
  }
}

/**
 * Get admin activity logs
 */
export async function getAdminActivityLogs(
  limit: number = 100,
  offset: number = 0
): Promise<Array<Record<string, unknown>>> {
  try {
    const logs = await db
      .select({
        id: audit_log.id,
        userId: audit_log.userId,
        action: audit_log.action,
        details: audit_log.details,
        createdAt: audit_log.createdAt,
        userName: user.name,
      })
      .from(audit_log)
      .leftJoin(user, eq(audit_log.userId, user.id))
      .where(
        // Admin actions typically start with 'admin_'
        sql`${audit_log.action} LIKE 'admin_%'`
      )
      .orderBy(desc(audit_log.createdAt))
      .limit(limit)
      .offset(offset);

    return logs;
  } catch (error) {
    console.error("Failed to get admin activity logs:", error);
    return [];
  }
}

/**
 * Cleanup old audit logs (for maintenance)
 */
export async function cleanupOldAuditLogs(
  daysToKeep: number = 90
): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    await db
      .delete(audit_log)
      .where(sql`${audit_log.createdAt} < ${cutoffDate}`);

    return 0; // Simplified return for now
  } catch (error) {
    console.error("Failed to cleanup old audit logs:", error);
    return 0;
  }
}

/**
 * Get audit statistics
 */
export async function getAuditStatistics(): Promise<{
  totalEvents: number;
  failedLogins: number;
  unauthorizedAccess: number;
  adminActions: number;
  dataAccess: number;
}> {
  try {
    // This would typically involve more complex queries
    // For now, return placeholder values
    return {
      totalEvents: 0,
      failedLogins: 0,
      unauthorizedAccess: 0,
      adminActions: 0,
      dataAccess: 0,
    };
  } catch (error) {
    console.error("Failed to get audit statistics:", error);
    return {
      totalEvents: 0,
      failedLogins: 0,
      unauthorizedAccess: 0,
      adminActions: 0,
      dataAccess: 0,
    };
  }
}

/**
 * Audit Logging Utility
 * 
 * Provides a simple interface for recording audit logs of significant actions.
 * Used for compliance, security, and debugging purposes.
 */

import { db } from "@/utils/db";
import { auditLogs } from "@/db/schema";
import type { AuditDetails } from "@/db/schema/types";

export interface AuditLogEntry {
  organizationId: string;
  userId?: string;
  action: string;
  details?: AuditDetails;
}

/**
 * Create an audit log entry
 * 
 * @param entry - The audit log entry to create
 * @returns The created audit log ID, or null if creation failed
 * 
 * @example
 * await createAuditLog({
 *   organizationId: "org-123",
 *   userId: "user-456",
 *   action: "billing_settings_updated",
 *   details: {
 *     resource: "billing_settings",
 *     changes: { 
 *       monthlyLimit: { before: 500, after: 1000 } 
 *     },
 *   },
 * });
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<string | null> {
  try {
    const [result] = await db.insert(auditLogs).values({
      organizationId: entry.organizationId,
      userId: entry.userId,
      action: entry.action,
      details: entry.details,
    }).returning({ id: auditLogs.id });

    return result?.id ?? null;
  } catch (error) {
    // Log but don't fail - audit logging should not break business logic
    console.error("[Audit] Failed to create audit log:", error);
    return null;
  }
}

/**
 * Create an audit log for billing settings changes
 * Convenience wrapper that formats the changes in the expected AuditDetails format
 */
export async function auditBillingSettingsChange(
  organizationId: string,
  userId: string | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  // Convert before/after snapshots to per-field changes format
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  
  // Get all keys from both before and after
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  
  for (const key of allKeys) {
    if (before[key] !== after[key]) {
      changes[key] = { before: before[key], after: after[key] };
    }
  }
  
  await createAuditLog({
    organizationId,
    userId,
    action: "billing_settings_updated",
    details: {
      resource: "billing_settings",
      changes,
    },
  });
}


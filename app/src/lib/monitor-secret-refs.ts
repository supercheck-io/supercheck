import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";
import { checkPermissionWithContext, isImpersonatedSession } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import type { AuthContext } from "@/lib/auth-context";

/** `audit` is merged into the monitor_created/monitor_updated metadata: secret names and the target host, never values or the full URL. */
type Result =
  | { success: true; audit?: { referencedSecrets: string[]; targetHost: string | null } }
  | { success: false; error: string; details: string; status?: number };

function hostOf(target: unknown): string | null {
  try {
    return typeof target === "string" ? new URL(target.trim()).host : null;
  } catch {
    return null;
  }
}

/** Secret names a monitor config refers to (AI endpoint key, bearer token or basic password). */
export function monitorSecretNames(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as { aiEndpoint?: { secretKey?: unknown }; auth?: { secretKey?: unknown } };
  return [c.aiEndpoint?.secretKey, c.auth?.secretKey].filter((n): n is string => typeof n === "string" && n !== "");
}

/**
 * Every secret a client-sent config names must be a secret variable of the monitor's own project, and the caller must
 * be allowed to use secrets: variable:view_secrets, and not an impersonated browser session (CLI tokens are exempt, as in
 * the decrypt route). Only the incoming config is checked, so a stored reference to a since-deleted secret never blocks an unrelated edit.
 * `target` is the effective monitor target, recorded as a host only.
 * `update` covers edits that keep a stored secret but send it somewhere new: when the target changes, the secrets the
 * effective config still names pass the same impersonation and permission gate (their existence is not re-checked).
 */
export async function validateMonitorSecretRefs(
  ctx: AuthContext,
  incomingConfig: unknown,
  target?: unknown,
  update?: { effectiveConfig: unknown; targetChanged: boolean },
): Promise<Result> {
  const projectId = ctx.project.id;
  const incoming = [...new Set(monitorSecretNames(incomingConfig))];
  const names = update?.targetChanged
    ? [...new Set([...incoming, ...monitorSecretNames(update.effectiveConfig)])]
    : incoming;
  if (names.length === 0) return { success: true };
  if (!ctx.isCliAuth && (await isImpersonatedSession())) {
    await logAuditEvent({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      action: "monitor_secret_ref_impersonation_blocked",
      resource: "monitor",
      metadata: { projectId, referencedSecrets: names },
      success: false,
    });
    return { success: false, error: "Forbidden", details: "Secrets cannot be used while impersonating a user", status: 403 };
  }
  if (!checkPermissionWithContext("variable", "view_secrets", ctx)) {
    return { success: false, error: "Forbidden", details: "Insufficient permissions to use project secrets", status: 403 };
  }
  const rows = incoming.length === 0 ? [] : await db
    .select({ key: projectVariables.key })
    .from(projectVariables)
    .where(
      and(
        eq(projectVariables.projectId, projectId),
        inArray(projectVariables.key, incoming),
        or(eq(projectVariables.isSecret, true), eq(projectVariables.type, "secret")),
      ),
    );
  const found = new Set(rows.map((r) => r.key));
  const missing = incoming.find((n) => !found.has(n));
  return missing
    ? { success: false, error: "Invalid monitor configuration", details: `Secret ${missing} was not found in this project` }
    : { success: true, audit: { referencedSecrets: names, targetHost: hostOf(target) } };
}

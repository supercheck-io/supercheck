import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/utils/db";
import { projectVariables } from "@/db/schema";

type Result = { success: true } | { success: false; error: string; details: string };

/** Secret names a monitor config refers to (AI endpoint key, bearer token or basic password). */
export function monitorSecretNames(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as { aiEndpoint?: { secretKey?: unknown }; auth?: { secretKey?: unknown } };
  return [c.aiEndpoint?.secretKey, c.auth?.secretKey].filter((n): n is string => typeof n === "string" && n !== "");
}

/**
 * Every secret a client-sent config names must be a secret variable of the monitor's own project.
 * Only the incoming config is checked, so a stored reference to a since-deleted secret never blocks an unrelated edit.
 */
export async function validateMonitorSecretRefs(projectId: string, incomingConfig: unknown): Promise<Result> {
  const names = [...new Set(monitorSecretNames(incomingConfig))];
  if (names.length === 0) return { success: true };
  const rows = await db
    .select({ key: projectVariables.key })
    .from(projectVariables)
    .where(
      and(
        eq(projectVariables.projectId, projectId),
        inArray(projectVariables.key, names),
        or(eq(projectVariables.isSecret, true), eq(projectVariables.type, "secret")),
      ),
    );
  const found = new Set(rows.map((r) => r.key));
  const missing = names.find((n) => !found.has(n));
  return missing
    ? { success: false, error: "Invalid monitor configuration", details: `Secret ${missing} was not found in this project` }
    : { success: true };
}

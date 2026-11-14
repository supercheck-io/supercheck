import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitors } from "@/db/schema";
import { liveMonitor } from "@/lib/deletion/visibility";

const MAX_LISTED = 5;

/**
 * 409 message when live monitors of the project still reference the secret by name (config.aiEndpoint.secretKey or
 * config.auth.secretKey); null when none do. Deleting, renaming or un-secreting it would silently break those checks.
 */
export async function secretInUseMessage(projectId: string, key: string, action: string): Promise<string | null> {
  const rows = await db
    .select({ name: monitors.name })
    .from(monitors)
    .where(
      and(
        eq(monitors.projectId, projectId),
        liveMonitor(),
        or(sql`${monitors.config}->'aiEndpoint'->>'secretKey' = ${key}`, sql`${monitors.config}->'auth'->>'secretKey' = ${key}`),
      ),
    )
    .orderBy(monitors.name)
    .limit(MAX_LISTED + 1);
  if (rows.length === 0) return null;
  const names = rows.slice(0, MAX_LISTED).map((r) => r.name).join(", ");
  return `Secret ${key} is used by ${rows.length > MAX_LISTED ? `more than ${MAX_LISTED} monitors, including` : "monitor"} ${names}. Update those monitors before you ${action} it.`;
}

/** True when an update changes the key or drops the secret flag, i.e. breaks references by name. */
export function breaksSecretRefs(
  existing: { key: string; isSecret: boolean; type: string },
  update: { key?: string; isSecret?: boolean },
): "rename" | "make non-secret" | null {
  if (!(existing.isSecret || existing.type === "secret")) return null;
  if (update.key !== undefined && update.key !== existing.key) return "rename";
  if (update.isSecret === false) return "make non-secret";
  return null;
}

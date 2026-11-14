import { and, eq, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { decryptValue } from '../common/services/variable-resolver.service';
import { liveMonitor } from '../db/deletion-visibility';

export type MonitorSecretResult =
  { ok: true; value: string } | { ok: false; message: string };

/**
 * Look up a project secret by NAME for a monitor. The project comes from the monitor row itself
 * (job data carries no projectId, and a client-supplied one is never trusted).
 */
export async function resolveMonitorSecret(
  db: PostgresJsDatabase<typeof schema>,
  monitorId: string,
  key: string,
): Promise<MonitorSecretResult> {
  const [row] = await db
    .select({
      projectId: schema.projectVariables.projectId,
      encryptedValue: schema.projectVariables.encryptedValue,
    })
    .from(schema.monitors)
    .innerJoin(
      schema.projectVariables,
      eq(schema.projectVariables.projectId, schema.monitors.projectId),
    )
    .where(
      and(
        eq(schema.monitors.id, monitorId),
        // A monitor being deleted never gets its secret.
        liveMonitor(),
        eq(schema.projectVariables.key, key),
        // Same rule as the variable resolver
        or(
          eq(schema.projectVariables.isSecret, true),
          eq(schema.projectVariables.type, 'secret'),
        ),
      ),
    )
    .limit(1);

  // Generic text: results and alerts reach viewers, who must not learn secret names.
  const notFound = {
    ok: false,
    message: 'The project secret for this monitor was not found',
  } as const;
  if (!row?.encryptedValue) return notFound;
  try {
    return { ok: true, value: decryptValue(row.encryptedValue, row.projectId) };
  } catch {
    return {
      ok: false,
      message: 'The project secret for this monitor could not be decrypted',
    };
  }
}

import { sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { notInPendingOrganization } from "@/lib/deletion/visibility";

export type HeartbeatPingKind = "ping" | "start" | "fail";

/**
 * Records one ping with a single UPDATE. The new state is an expression on the row's current
 * value (no read-modify-write), so a concurrent ping, sweep or monitor edit cannot lose it.
 * Paused, disabled, deleting and pending-deletion monitors match no row and change nothing.
 * Returns whether a monitor matched (for tests only; callers must answer the same either way).
 */
export async function recordHeartbeatPing(
  tokenHash: string,
  kind: HeartbeatPingKind,
  userAgent: string | null,
): Promise<boolean> {
  const ua = userAgent ? userAgent.slice(0, 120) : null;
  const patch =
    kind === "start"
      ? sql`jsonb_build_object('lastStartAt', to_jsonb(now()))`
      : sql`jsonb_strip_nulls(jsonb_build_object(
          'lastPingAt', to_jsonb(now()),
          'lastPingKind', ${kind}::text,
          'pingSeq', coalesce((m.heartbeat_state->>'pingSeq')::bigint, 0) + 1,
          'lastUserAgent', ${ua}::text
        ))`;
  const rows = await db.execute(sql`
    UPDATE monitors AS m
    SET heartbeat_state = coalesce(m.heartbeat_state, '{}'::jsonb) || ${patch}
      ${kind === "start" ? sql`` : sql`, last_check_at = now()`}
    WHERE m.heartbeat_token_hash = ${tokenHash}
      AND m.type = 'heartbeat'
      AND m.enabled = true
      AND m.status <> 'paused'
      AND m.deleting_at IS NULL
      AND ${notInPendingOrganization(sql`m.organization_id`)}
    RETURNING m.id
  `);
  return rows.length > 0;
}

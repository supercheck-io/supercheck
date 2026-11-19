import { sql } from "drizzle-orm";

import { alertHistory } from "@/db/schema";
import { db } from "@/utils/db";
import { loadProviderTestHealth, newerHealth, providerHealth, type ProviderHealth } from "./health";

/**
 * Health per channel (newest delivery in the last 7 days, or a newer test) and when it last sent an alert.
 */
export async function loadProviderHealth(
  providerIds: string[],
): Promise<{ health: Map<string, ProviderHealth>; lastUsed: Map<string, Date>; lastTest: Map<string, ProviderHealth> }> {
  if (providerIds.length === 0) return { health: new Map(), lastUsed: new Map(), lastTest: new Map() };
  // One index probe per channel on alert_history_provider_sent_at_idx; DISTINCT ON would read every row of each
  // channel. NULLS LAST must match the index, or the planner walks sent_at_idx and scans the table for a quiet channel.
  const latest = await db.execute<{ provider: string; status: string; sentAt: Date | string; responseStatus: number | null; terminal: boolean }>(sql`
    select p.id as provider, h.status, h.sent_at as "sentAt",
      (h.delivery_metadata->'delivery'->>'responseStatus')::int as "responseStatus",
      coalesce((h.delivery_metadata->'delivery'->>'terminal')::boolean, false) as terminal
    from unnest(array[${sql.join(providerIds.map((id) => sql`${id}`), sql`, `)}]::varchar[]) as p(id)
    cross join lateral (
      select status, sent_at, delivery_metadata from ${alertHistory}
      where provider = p.id and sent_at is not null
      order by sent_at desc nulls last
      limit 1
    ) h`);
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tests = await loadProviderTestHealth(providerIds);
  const health = new Map<string, ProviderHealth>();
  const lastUsed = new Map<string, Date>();
  for (const id of providerIds) {
    const found = latest.find((r) => r.provider === id);
    const row = found && { ...found, sentAt: new Date(found.sentAt) };
    if (row) lastUsed.set(id, row.sentAt);
    // A test sent after fixing a key counts too, so the badge clears without waiting for the next alert.
    const delivery = row && row.sentAt.getTime() >= since ? providerHealth(row) : undefined;
    health.set(id, newerHealth(delivery, tests.get(id)) ?? { state: "unknown", at: null });
  }
  return { health, lastUsed, lastTest: tests };
}

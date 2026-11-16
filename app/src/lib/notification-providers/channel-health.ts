import { desc, inArray, sql } from "drizzle-orm";

import { alertHistory } from "@/db/schema";
import { db } from "@/utils/db";
import { loadProviderTestHealth, newerHealth, providerHealth, type ProviderHealth } from "./health";

/**
 * Health per channel (newest delivery in the last 7 days, or a newer test) and when it last sent an alert.
 * shortcut: alert_history has no index leading with provider, so this scans the provider rows by sent_at; add
 * (provider, sent_at DESC) in a no-transaction migration if the channel list gets slow.
 */
export async function loadProviderHealth(providerIds: string[]): Promise<{ health: Map<string, ProviderHealth>; lastUsed: Map<string, Date> }> {
  if (providerIds.length === 0) return { health: new Map(), lastUsed: new Map() };
  const latest = await db
    .selectDistinctOn([alertHistory.provider], {
      provider: alertHistory.provider,
      status: alertHistory.status,
      sentAt: alertHistory.sentAt,
      responseStatus: sql<number | null>`(${alertHistory.deliveryMetadata}->'delivery'->>'responseStatus')::int`,
      terminal: sql<boolean>`coalesce((${alertHistory.deliveryMetadata}->'delivery'->>'terminal')::boolean, false)`,
    })
    .from(alertHistory)
    .where(inArray(alertHistory.provider, providerIds))
    .orderBy(alertHistory.provider, desc(alertHistory.sentAt));
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tests = await loadProviderTestHealth(providerIds);
  const health = new Map<string, ProviderHealth>();
  const lastUsed = new Map<string, Date>();
  for (const id of providerIds) {
    const row = latest.find((r) => r.provider === id);
    if (row?.sentAt) lastUsed.set(id, row.sentAt);
    // A test sent after fixing a key counts too, so the badge clears without waiting for the next alert.
    const delivery = row?.sentAt && new Date(row.sentAt).getTime() >= since ? providerHealth(row) : undefined;
    health.set(id, newerHealth(delivery, tests.get(id)) ?? { state: "unknown", at: null });
  }
  return { health, lastUsed };
}

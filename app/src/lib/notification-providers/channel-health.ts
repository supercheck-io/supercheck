import { desc, inArray, sql } from "drizzle-orm";

import { alertHistory } from "@/db/schema";
import { db } from "@/utils/db";
import { loadProviderTestHealth, newerHealth, providerHealth, type ProviderHealth } from "./health";

/** Health per channel (newest delivery in the last 7 days, or a newer test); the same rule as the channel list route. */
export async function loadProviderHealth(providerIds: string[]): Promise<Map<string, ProviderHealth>> {
  if (providerIds.length === 0) return new Map();
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
  const result = new Map<string, ProviderHealth>();
  for (const id of providerIds) {
    const row = latest.find((r) => r.provider === id);
    const delivery = row?.sentAt && new Date(row.sentAt).getTime() >= since ? providerHealth(row) : undefined;
    result.set(id, newerHealth(delivery, tests.get(id)) ?? { state: "unknown", at: null });
  }
  return result;
}

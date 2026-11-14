import { getRedisConnection } from "@/lib/queue";
import { withRedisDeadline } from "@/lib/security/redis-deadline";

/** A channel's state from its newest delivery in the last 7 days (shown as a badge on the channel list). */
export type ProviderHealth = { state: "ok" | "auth_failed" | "failing" | "unknown"; at: string | null };

export function providerHealth(row: { status: string; sentAt: Date | null; responseStatus: number | null; terminal: boolean }): ProviderHealth {
  const at = row.sentAt ? new Date(row.sentAt).toISOString() : null;
  if (row.status === "sent") return { state: "ok", at };
  if (row.status !== "failed") return { state: "unknown", at };
  return { state: row.terminal || row.responseStatus === 401 || row.responseStatus === 403 ? "auth_failed" : "failing", at };
}

const TEST_KEY = (providerId: string) => `supercheck:notification-test:${providerId}`;
const TEST_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Remembers a saved channel's latest test outcome for 7 days, so fixing a key shows as healthy at once. Best effort. */
export async function recordProviderTest(providerId: string, outcome: { ok: boolean; responseStatus?: number }, at = new Date()) {
  try {
    const redis = await getRedisConnection();
    // Bounded: the shared client queues commands while Redis is down, which would hang the request.
    await withRedisDeadline(redis, () =>
      redis.set(TEST_KEY(providerId), JSON.stringify({ ok: outcome.ok, responseStatus: outcome.responseStatus ?? null, at: at.toISOString() }), "EX", TEST_TTL_SECONDS),
    );
  } catch {
    // Health simply falls back to real deliveries.
  }
}

/** Latest test outcome per channel, as health. Missing or unreadable entries are skipped. */
export async function loadProviderTestHealth(providerIds: string[]): Promise<Map<string, ProviderHealth>> {
  const result = new Map<string, ProviderHealth>();
  if (providerIds.length === 0) return result;
  try {
    const redis = await getRedisConnection();
    const values = await withRedisDeadline(redis, () => redis.mget(...providerIds.map(TEST_KEY)));
    values.forEach((value, index) => {
      if (!value) return;
      try {
        const test = JSON.parse(value) as { ok: boolean; responseStatus: number | null; at: string };
        result.set(providerIds[index], providerHealth({ status: test.ok ? "sent" : "failed", sentAt: new Date(test.at), responseStatus: test.responseStatus, terminal: false }));
      } catch {
        // Ignore a malformed entry.
      }
    });
  } catch {
    // Without Redis, health comes from deliveries only.
  }
  return result;
}

/** The newer of the delivery-based and the test-based health. */
export function newerHealth(a: ProviderHealth | undefined, b: ProviderHealth | undefined): ProviderHealth | undefined {
  if (!a) return b;
  if (!b) return a;
  return (Date.parse(b.at ?? "") || 0) > (Date.parse(a.at ?? "") || 0) ? b : a;
}

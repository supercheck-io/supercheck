/** A channel's state from its newest delivery in the last 7 days (shown as a badge on the channel list). */
export type ProviderHealth = { state: "ok" | "auth_failed" | "failing" | "unknown"; at: string | null };

export function providerHealth(row: { status: string; sentAt: Date | null; responseStatus: number | null; terminal: boolean }): ProviderHealth {
  const at = row.sentAt ? new Date(row.sentAt).toISOString() : null;
  if (row.status === "sent") return { state: "ok", at };
  if (row.status !== "failed") return { state: "unknown", at };
  return { state: row.terminal || row.responseStatus === 401 || row.responseStatus === 403 ? "auth_failed" : "failing", at };
}

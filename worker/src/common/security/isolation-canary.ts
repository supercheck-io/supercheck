/** Only a fresh, explicit canary failure closes admission; missing data stays open. */
export function isIsolationPoolBlocked(
  raw: string | undefined,
  now = Date.now(),
): boolean {
  if (!raw) return false;
  try {
    const health = JSON.parse(raw) as {
      status?: unknown;
      completedAt?: unknown;
    };
    if (health.status !== 'failed' || typeof health.completedAt !== 'string')
      return false;
    const completedAt = Date.parse(health.completedAt);
    const age = now - completedAt;
    return Number.isFinite(age) && age >= 0 && age <= 20 * 60 * 1000;
  } catch {
    return false;
  }
}

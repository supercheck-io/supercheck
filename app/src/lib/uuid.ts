const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Postgres raises (and the API would answer 500) for anything else in a uuid column. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** True when a database error is Postgres rejecting a malformed uuid (22P02), so callers can answer 404 instead of 500. */
export function isInvalidUuidError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "22P02") return true;
    if (typeof e.message === "string" && /invalid input syntax for type uuid/i.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}

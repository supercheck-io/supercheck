/** Reject malformed pool sizes instead of silently truncating configuration. */
export function getDatabasePoolMax(value = process.env.DB_POOL_MAX): number {
  if (value === undefined || value === '') return 10;
  const max = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(max) || max < 1) {
    throw new Error('DB_POOL_MAX must be a positive integer for the worker');
  }
  return max;
}

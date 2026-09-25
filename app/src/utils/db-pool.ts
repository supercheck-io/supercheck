/** Require an explicit pool size to be a whole number. The usage scheduler
 * holds an advisory-lock connection while using another connection for work. */
export function getDatabasePoolMax(value = process.env.DB_POOL_MAX): number {
  if (value === undefined || value === "") return 30;
  const max = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(max) || max < 2) {
    throw new Error("DB_POOL_MAX must be an integer of at least 2 for the app");
  }
  return max;
}

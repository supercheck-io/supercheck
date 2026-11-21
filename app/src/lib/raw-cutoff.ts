const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Raw monitor results are kept from the start (UTC) of the day `days` ago; cleanup deletes only older rows. Deleting
 * whole UTC days keeps every remaining day complete, so the daily rollup never recomputes a day from partly purged
 * rows. Pure (no server imports), so the results date picker can use the same boundary.
 */
export function rawCutoff(days: number, now = Date.now()): Date {
  const cutoff = new Date(now - days * DAY_MS);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

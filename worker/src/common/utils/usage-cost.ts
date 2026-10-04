/** Round currency in cents after removing binary floating-point noise.
 * K6 counts whole VU-minutes and rates have at most four decimal cent places.
 */
export function ceilUsageCostCents(units: number, rateCents: number): number {
  return Math.ceil(Number((units * rateCents).toFixed(6)));
}

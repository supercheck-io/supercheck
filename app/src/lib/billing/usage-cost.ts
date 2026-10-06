/** Round currency in cents after removing binary floating-point noise.
 * K6 has whole units and four-decimal cent rates; SRE has four-decimal units
 * and whole-cent rates. Round only after aggregating each meter's overage.
 */
export function ceilUsageCostCents(units: number, rateCents: number): number {
  return Math.ceil(Number((units * rateCents).toFixed(6)));
}

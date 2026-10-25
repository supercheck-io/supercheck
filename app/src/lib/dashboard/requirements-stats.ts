/**
 * Pure helpers for the dashboard requirements card.
 *
 * "At risk" is defined once, here: a HIGH priority requirement whose coverage
 * is failing, missing, or has never been computed (no snapshot).
 */

export const AT_RISK_PRIORITIES = ["high"] as const;

export type RequirementStatusCountRow = {
  /** Coverage snapshot status, or null when the requirement has no snapshot yet. */
  status: string | null;
  count: number | string;
};

export type RequirementCoverageTotals = {
  total: number;
  covered: number;
  failing: number;
  missing: number;
};

/**
 * Sums grouped coverage rows. A null status (no snapshot) and an explicit
 * "missing" status are different groups that both mean "not covered by any
 * test", so they accumulate into `missing` instead of overwriting each other.
 */
export function accumulateRequirementCoverage(
  rows: RequirementStatusCountRow[]
): RequirementCoverageTotals {
  const totals: RequirementCoverageTotals = {
    total: 0,
    covered: 0,
    failing: 0,
    missing: 0,
  };

  for (const row of rows) {
    const count = Number(row.count) || 0;
    totals.total += count;
    if (row.status === "covered") totals.covered += count;
    else if (row.status === "failing") totals.failing += count;
    else totals.missing += count;
  }

  return totals;
}

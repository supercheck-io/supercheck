import { liveMonitor } from "@/lib/deletion/visibility";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitorAggregates, monitorResults, monitors } from "@/db/schema";
import { excludeSupersededSyntheticResults } from "@/lib/monitor-result-filters";

/**
 * Raw check-row counts per UTC period for a project, served from monitor_aggregates where they hold and
 * from monitor_results only for the rest.
 *
 * Counts are rows (one per region), not cycles: the per-location aggregate rows are summed, never the
 * combined row. The aggregator builds both from the same raw rows with the same
 * `excludeSupersededSyntheticResults` filter used by the raw path below, so the two agree.
 */
export type PeriodCounts = Map<number, { total: number; up: number }>;
export type RawGap = { monitorId: string; from: number; to: number | null };

const UNIT_MS = { hourly: 3_600_000, daily: 86_400_000 } as const;

/**
 * Raw ranges a monitor still needs: the partial first period, the last completed and the in-progress
 * period (late rows land in them until the next aggregator run), and every full period in between without
 * an aggregate row (not aggregated yet, missed, or no checks). Overlapping or adjacent ranges are merged.
 */
export function planRawGaps(input: {
  monitors: { id: string }[];
  covered: Map<string, Set<number>>;
  from: number;
  now: number;
  unit: number;
}): RawGap[] {
  const { from, now, unit } = input;
  const firstFull = Math.ceil(from / unit) * unit;
  const aggregatedEnd = Math.floor(now / unit) * unit - unit;
  const gaps: RawGap[] = [];
  for (const monitor of input.monitors) {
    const ranges: [number, number | null][] = [[Math.max(aggregatedEnd, from), null]];
    if (firstFull > from) ranges.push([from, firstFull]);
    const have = input.covered.get(monitor.id);
    for (let p = firstFull; p < aggregatedEnd; p += unit) {
      if (!have?.has(p)) ranges.push([p, p + unit]);
    }
    ranges.sort((x, y) => x[0] - y[0]);
    const merged: [number, number | null][] = [];
    for (const [a, b] of ranges) {
      const last = merged[merged.length - 1];
      if (last && (last[1] === null || a <= last[1])) last[1] = last[1] === null || b === null ? null : Math.max(last[1], b);
      else merged.push([a, b]);
    }
    for (const [a, b] of merged) gaps.push({ monitorId: monitor.id, from: a, to: b });
  }
  return gaps;
}

export async function getRowCountsByPeriod(input: {
  organizationId: string;
  projectId: string;
  from: Date;
  now: Date;
  period: "hourly" | "daily";
}): Promise<PeriodCounts> {
  const unit = UNIT_MS[input.period];
  const from = input.from.getTime();
  const firstFull = Math.ceil(from / unit) * unit;
  // The last completed period is read raw too: results that arrive after the aggregator ran would be missed.
  const aggregatedEnd = Math.floor(input.now.getTime() / unit) * unit - unit;
  const scope = and(
    eq(monitors.projectId, input.projectId),
    eq(monitors.organizationId, input.organizationId),
    liveMonitor(),
  );

  const [projectMonitors, aggregated] = await Promise.all([
    db.select({ id: monitors.id }).from(monitors).where(scope),
    firstFull >= aggregatedEnd
      ? []
      : db
          .select({
            monitorId: monitorAggregates.monitorId,
            periodStart: monitorAggregates.periodStart,
            total: sql<number>`sum(${monitorAggregates.totalChecks})::int`,
            up: sql<number>`sum(${monitorAggregates.successfulChecks})::int`,
          })
          .from(monitorAggregates)
          .innerJoin(monitors, eq(monitorAggregates.monitorId, monitors.id))
          .where(
            and(
              scope,
              eq(monitorAggregates.periodType, input.period),
              isNotNull(monitorAggregates.location),
              gte(monitorAggregates.periodStart, new Date(firstFull)),
              lt(monitorAggregates.periodStart, new Date(aggregatedEnd)),
            ),
          )
          .groupBy(monitorAggregates.monitorId, monitorAggregates.periodStart),
  ]);

  const out: PeriodCounts = new Map();
  const add = (period: number, total: number, up: number) => {
    const entry = out.get(period) ?? { total: 0, up: 0 };
    entry.total += total;
    entry.up += up;
    out.set(period, entry);
  };
  const covered = new Map<string, Set<number>>();
  for (const row of aggregated) {
    const t = row.periodStart.getTime();
    add(t, Number(row.total), Number(row.up));
    const set = covered.get(row.monitorId) ?? new Set<number>();
    set.add(t);
    covered.set(row.monitorId, set);
  }

  const gaps = planRawGaps({ monitors: projectMonitors, covered, from, now: input.now.getTime(), unit });
  if (gaps.length === 0) return out;
  // Ranges travel as one JSON parameter (a bind per range would hit Postgres's 65,535 limit on big projects).
  const ranges = JSON.stringify(
    gaps.map((gap) => ({
      m: gap.monitorId,
      f: new Date(gap.from).toISOString(),
      // "infinity" keeps the upper bound a plain comparison, so the (monitor_id, checked_at) index bounds both ends.
      t: gap.to === null ? "infinity" : new Date(gap.to).toISOString(),
    })),
  );
  const raw = await db.execute<{ period: string; total: number; up: number }>(sql`
    SELECT floor(extract(epoch from ${monitorResults.checkedAt}) / ${sql.raw(String(unit / 1000))}) AS period,
           count(*)::int AS total,
           (count(*) filter (where ${monitorResults.isUp}))::int AS up
    FROM jsonb_to_recordset(${ranges}::jsonb) AS g(m uuid, f timestamptz, t timestamptz)
    JOIN ${monitorResults} ON ${monitorResults.monitorId} = g.m
      AND ${monitorResults.checkedAt} >= g.f AND ${monitorResults.checkedAt} < g.t
    WHERE ${excludeSupersededSyntheticResults}
    GROUP BY 1`);
  for (const row of raw) add(Number(row.period) * unit, Number(row.total), Number(row.up));
  return out;
}

import { and, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
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
 * Raw ranges a monitor still needs: the partial first period, the in-progress one (open-ended), and every
 * full period in between without an aggregate row (not aggregated yet, missed, or no checks), skipping
 * periods before the monitor existed. Adjacent ranges are merged.
 */
export function planRawGaps(input: {
  monitors: { id: string; createdAt: Date | null }[];
  covered: Map<string, Set<number>>;
  from: number;
  now: number;
  unit: number;
}): RawGap[] {
  const { from, now, unit } = input;
  const firstFull = Math.ceil(from / unit) * unit;
  const current = Math.floor(now / unit) * unit;
  const gaps: RawGap[] = [];
  for (const monitor of input.monitors) {
    const mine: RawGap[] = [];
    const add = (a: number, b: number | null) => {
      const last = mine[mine.length - 1];
      if (last && last.to === a) last.to = b;
      else mine.push({ monitorId: monitor.id, from: a, to: b });
    };
    if (firstFull > current) {
      add(from, null); // the whole window sits in the unfinished period
    } else {
      if (firstFull > from) add(from, firstFull);
      const have = input.covered.get(monitor.id);
      for (let p = firstFull; p < current; p += unit) {
        if (p + unit <= (monitor.createdAt?.getTime() ?? 0) || have?.has(p)) continue;
        add(p, p + unit);
      }
      add(current, null);
    }
    gaps.push(...mine);
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
  const current = Math.floor(input.now.getTime() / unit) * unit;
  const scope = and(
    eq(monitors.projectId, input.projectId),
    eq(monitors.organizationId, input.organizationId),
  );

  const [projectMonitors, aggregated] = await Promise.all([
    db.select({ id: monitors.id, createdAt: monitors.createdAt }).from(monitors).where(scope),
    firstFull >= current
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
              lt(monitorAggregates.periodStart, new Date(current)),
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
  const period = sql<number>`floor(extract(epoch from ${monitorResults.checkedAt}) / ${sql.raw(String(unit / 1000))})`.mapWith(Number);
  const raw = await db
    .select({
      period,
      total: sql<number>`count(*)::int`,
      up: sql<number>`(count(*) filter (where ${monitorResults.isUp}))::int`,
    })
    .from(monitorResults)
    .where(
      and(
        or(
          ...gaps.map((gap) =>
            and(
              eq(monitorResults.monitorId, gap.monitorId),
              gte(monitorResults.checkedAt, new Date(gap.from)),
              gap.to === null ? undefined : lt(monitorResults.checkedAt, new Date(gap.to)),
            ),
          ),
        ),
        excludeSupersededSyntheticResults,
      ),
    )
    .groupBy(period);
  for (const row of raw) add(row.period * unit, Number(row.total), Number(row.up));
  return out;
}

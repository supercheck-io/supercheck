/** @jest-environment node */
// Which existing aggregates the daily rollup may rewrite, against a scripted database: the raw purge watermark
// (monitors.raw_purged_before) and the oldest ordinary raw row both freeze older periods. The same rules run
// against real PostgreSQL in monitor-aggregation-service.db.spec.ts.

type Row = Record<string, unknown>;
const mockData: { batch: Row[]; bounds: Row[]; oldest: Row[]; rows: Row[]; existing: Row[] } = {
  batch: [], bounds: [], oldest: [], rows: [], existing: [],
};
const mockWritten: Row[] = [];

jest.mock("@/utils/db", () => {
  const { getTableName } = jest.requireActual("drizzle-orm");
  const select = () => {
    let table = "";
    let limited = false;
    let paged = false;
    const pick = () =>
      table === "monitors"
        ? paged ? mockData.batch : mockData.bounds
        : table === "monitor_results"
          ? limited ? mockData.oldest : mockData.rows
          : table === "monitor_aggregates" ? mockData.existing : [];
    const query = {
      from: (t: object) => { table = getTableName(t); return query; },
      where: () => query,
      orderBy: () => query,
      limit: () => { limited = true; return query; },
      offset: () => { paged = true; return query; },
      then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(pick()).then(resolve, reject),
    };
    return query;
  };
  return {
    db: {
      select,
      insert: () => ({
        values: (values: Row[]) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              mockWritten.push(...values);
              return values.map(() => ({ inserted: false }));
            },
          }),
        }),
      }),
      delete: () => ({ where: async () => undefined }),
    },
  };
});

import { monitorAggregationService } from "./monitor-aggregation-service";

const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;
const dayAgo = (days: number) => today - days * DAY;
const check = (at: number, isUp: boolean, isStatusChange = false) => ({
  checkedAt: new Date(at), location: "local", isUp, responseTimeMs: isUp ? 100 : null, isStatusChange,
  executionGroupId: null, inMaintenance: false, expectedLocations: null,
});
const aggregate = (day: number, location: string | null, totalChecks: number) => ({
  id: `${day}-${location}`, periodStart: new Date(dayAgo(day)), location, totalChecks,
});
const writtenFor = (day: number) =>
  mockWritten
    .filter((row) => (row.periodStart as Date).getTime() === dayAgo(day))
    .map((row) => [row.location, row.totalChecks]);

beforeEach(() => {
  mockWritten.length = 0;
  mockData.batch = [{ id: "monitor-1", organizationId: "org-1" }];
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("keeps a day before the watermark whose only survivors are a status change and a refused report, and still recomputes a later day", async () => {
  // Day -5: a refused report (an ordinary row), so the oldest raw row is older than the purged day -4.
  // Day -4 was aggregated from 12 checks; cleanup then left only a status change and a refused report.
  mockData.rows = [
    check(dayAgo(5) + 3_600_000, true),
    check(dayAgo(4) + 300_000, false, true),
    check(dayAgo(4) + 7_500_000, true),
    check(dayAgo(1) + 60_000, true),
    check(dayAgo(1) + 120_000, true),
    check(dayAgo(1) + 180_000, false),
  ];
  mockData.oldest = [{ checkedAt: new Date(dayAgo(5) + 3_600_000) }];
  mockData.bounds = [{ rawPurgedBefore: new Date(dayAgo(3)), oldestRaw: new Date(dayAgo(5) + 3_600_000) }];
  mockData.existing = [aggregate(4, null, 12), aggregate(4, "local", 12), aggregate(1, null, 1), aggregate(1, "local", 1)];

  const result = await monitorAggregationService.runDailyAggregation();

  expect(result.errors).toEqual([]);
  expect(writtenFor(4)).toEqual([]);
  expect(writtenFor(1)).toEqual([["local", 3], [null, 3]]);
});

it.each([
  ["no watermark yet", null],
  ["a watermark older than the day", new Date(dayAgo(10))],
])("recomputes a synthetic monitor's day with %s, although each of its rows carries a test execution", async (_label, watermark) => {
  // The rollup reads no test execution columns: rows that point at a report are ordinary checks to it.
  mockData.rows = [check(dayAgo(2) + 60_000, true), check(dayAgo(2) + 120_000, false), check(dayAgo(2) + 180_000, true)];
  mockData.oldest = [{ checkedAt: new Date(dayAgo(2) + 60_000) }];
  mockData.bounds = [{ rawPurgedBefore: watermark, oldestRaw: new Date(dayAgo(2) + 60_000) }];
  mockData.existing = [aggregate(2, null, 1), aggregate(2, "local", 1)];

  expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
  expect(writtenFor(2)).toEqual([["local", 3], [null, 3]]);
});

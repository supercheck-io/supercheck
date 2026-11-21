/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
// Raw monitor_results and monitor_aggregates retention against real PostgreSQL: per-plan windows, status-change and
// artifact handling, per-organization caps, the resume cursor, partial runs and lag reporting.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true }));
const mockDeleteReports = jest.fn();
const mockFailedIds = jest.fn();
jest.mock("./s3-cleanup", () => ({
  createS3CleanupService: () => ({ deleteReports: mockDeleteReports, getFailedReportEntityIds: mockFailedIds }),
}));
const mockReportProblem = jest.fn();
jest.mock("@/lib/sentry-lazy", () => ({ reportProblem: (...args: unknown[]) => mockReportProblem(...args) }));

import { monitorAggregationService } from "./monitor-aggregation-service";
import {
  MonitorAggregatesCleanupStrategy,
  MonitorResultsCleanupStrategy,
  type CleanupCursorStore,
  type CleanupStrategyConfig,
} from "./data-lifecycle-service";

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, "../..");
const databaseName = `results_cleanup_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let dbUrl: string;

// Ids fix the walk order (organizations are visited by id).
const ORG = {
  pro: "a0000000-0000-7000-8000-000000000000",
  plus: "b0000000-0000-7000-8000-000000000000",
  trial: "c0000000-0000-7000-8000-000000000000",
  none: "d0000000-0000-7000-8000-000000000000",
  billing: "e0000000-0000-7000-8000-000000000000", // active subscription, plan not set yet: skipped
};
const monitorOf: Record<keyof typeof ORG, string> = { pro: "", plus: "", trial: "", none: "", billing: "" };

function memoryCursor(initial: string | null = null): CleanupCursorStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (_key: string, value: string | null) => {
      store.value = value;
    },
  };
  return store;
}

const resultsStrategy = (overrides: Partial<CleanupStrategyConfig> = {}, custom: Record<string, unknown> = {}) =>
  new MonitorResultsCleanupStrategy({
    entityType: "monitor_results",
    enabled: true,
    cronSchedule: "10 * * * *",
    batchSize: 200,
    maxRecordsPerRun: 100_000,
    ...overrides,
    customConfig: { pauseMs: 0, ...custom },
  });

/** `count` rows for a monitor, `ageDays` old (one second apart). */
async function addResults(monitorId: string, ageDays: number, count = 1, extra: { statusChange?: boolean } = {}) {
  await client`
    INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, is_status_change, details)
    SELECT uuidv7(), ${monitorId}, now() - make_interval(days => ${ageDays}) - make_interval(secs => g), 'up', true, ${extra.statusChange ?? false}, '{}'::jsonb
    FROM generate_series(1, ${count}) g`;
}
const ages = async (monitorId: string) =>
  (await client`SELECT round(extract(epoch FROM now() - checked_at) / 86400)::int AS age, is_status_change FROM monitor_results WHERE monitor_id = ${monitorId} ORDER BY checked_at DESC`).map(
    (r) => `${r.age}${r.is_status_change ? "s" : ""}`,
  );
const countRows = async (monitorId: string) =>
  Number((await client`SELECT count(*)::int AS n FROM monitor_results WHERE monitor_id = ${monitorId}`)[0].n);

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  dbUrl = url.toString();
  await execFileAsync(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 120_000,
  });
  client = postgres(url.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 240_000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockDeleteReports.mockReset().mockResolvedValue({ success: true, deletedObjects: [], failedObjects: [] });
  mockFailedIds.mockReset().mockReturnValue(new Set());
  mockReportProblem.mockReset();
  await client`TRUNCATE monitors, organization, reports CASCADE`;
  const plans: Record<keyof typeof ORG, [string | null, string | null]> = {
    pro: ["pro", "active"],
    plus: ["plus", "active"],
    trial: [null, null],
    none: [null, "canceled"],
    billing: [null, "active"],
  };
  for (const key of Object.keys(ORG) as Array<keyof typeof ORG>) {
    const [plan, status] = plans[key];
    await client`INSERT INTO organization (id, name, created_at, subscription_plan, subscription_status) VALUES (${ORG[key]}, ${key}, now(), ${plan}, ${status})`;
    const [project] = await client`INSERT INTO projects (id, organization_id, name) VALUES (uuidv7(), ${ORG[key]}, 'p') RETURNING id`;
    const [monitor] = await client`
      INSERT INTO monitors (id, organization_id, project_id, name, type, target, status)
      VALUES (uuidv7(), ${ORG[key]}, ${project.id}, ${key}, 'http_request', 'https://example.com', 'up') RETURNING id`;
    monitorOf[key] = monitor.id;
  }
});

describe("monitor_results", () => {
  it("applies each plan's window, keeps status-change rows and skips an organization whose plan is being set; a rerun is a no-op", async () => {
    for (const key of Object.keys(ORG) as Array<keyof typeof ORG>) {
      await addResults(monitorOf[key], 3);
      await addResults(monitorOf[key], 10);
      await addResults(monitorOf[key], 40);
      await addResults(monitorOf[key], 40, 1, { statusChange: true });
    }
    const cursor = memoryCursor();
    const first = await resultsStrategy().execute(false, { cursor });
    expect(first).toEqual(expect.objectContaining({ success: true, recordsDeleted: 7 }));
    expect(first.details).toEqual(expect.objectContaining({ partial: false, organizationsProcessed: 4 }));

    expect(await ages(monitorOf.pro)).toEqual(["3", "10", "40s"]); // Pro: 30 days
    expect(await ages(monitorOf.plus)).toEqual(["3", "40s"]); // Plus: 7 days
    expect(await ages(monitorOf.trial)).toEqual(["3", "40s"]); // trial: 7 days
    expect(await ages(monitorOf.none)).toEqual(["3", "40s"]); // no plan: shortest window
    expect(await ages(monitorOf.billing)).toEqual(["3", "10", "40s", "40"]); // skipped this run
    expect(cursor.value).toBeNull();

    const again = await resultsStrategy().execute(false, { cursor });
    expect(again).toEqual(expect.objectContaining({ success: true, recordsDeleted: 0 }));
  });

  it("sends artifact rows through object storage first; a details.reportUrl row is never fast-path deleted", async () => {
    const m = monitorOf.plus;
    const old = "now() - interval '20 days'";
    await client.unsafe(`
      INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, is_status_change, test_execution_id, test_report_s3_url, details) VALUES
        (uuidv7(), '${m}', ${old} - interval '1 s', 'down', false, false, 'exec-down', NULL, '{}'),
        (uuidv7(), '${m}', ${old} - interval '2 s', 'up', true, false, NULL, 's3://bucket/report-a', '{}'),
        (uuidv7(), '${m}', ${old} - interval '3 s', 'up', true, false, NULL, NULL, '{"reportUrl": "s3://bucket/report-b"}'),
        (uuidv7(), '${m}', ${old} - interval '4 s', 'up', true, false, NULL, NULL, NULL),
        (uuidv7(), '${m}', ${old} - interval '5 s', 'down', false, true, 'exec-status', NULL, '{"reportUrl": "s3://bucket/report-c"}')`);
    await client`INSERT INTO reports (id, entity_type, entity_id, report_path, s3_url) VALUES (uuidv7(), 'monitor', 'exec-down', 'exec-down/report', NULL)`;
    // Storage refuses report-b, so its row must survive: only the artifact path may delete it.
    mockDeleteReports.mockImplementation(async (inputs: Array<{ entityId: string; s3Url?: string }>) => {
      const failed = inputs.filter((i) => i.s3Url === "s3://bucket/report-b");
      mockFailedIds.mockReturnValue(new Set(failed.map((i) => i.entityId)));
      return { success: failed.length === 0, deletedObjects: inputs.filter((i) => !failed.includes(i)), failedObjects: failed };
    });

    const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(result.success).toBe(true); // a storage failure is retried by the next hourly run, not by failing this one
    expect(result.errors).toEqual([expect.stringContaining("S3 failures")]);
    const inputs = mockDeleteReports.mock.calls.flatMap(([batch]) => batch);
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reportPath: "exec-down" }),
        expect.objectContaining({ s3Url: "s3://bucket/report-a" }),
        expect.objectContaining({ s3Url: "s3://bucket/report-b" }),
        expect.objectContaining({ reportPath: "exec-status", s3Url: "s3://bucket/report-c" }),
      ]),
    );
    const left = await client`SELECT is_status_change, test_execution_id, details FROM monitor_results WHERE monitor_id = ${m} ORDER BY checked_at DESC`;
    expect(left).toEqual([
      { is_status_change: false, test_execution_id: null, details: { reportUrl: "s3://bucket/report-b" } },
      { is_status_change: true, test_execution_id: null, details: {} }, // status change kept, its report expired
    ]);
    expect(await client`SELECT entity_id FROM reports`).toEqual([]);

    mockDeleteReports.mockResolvedValue({ success: true, deletedObjects: [], failedObjects: [] });
    mockFailedIds.mockReturnValue(new Set());
    expect((await resultsStrategy().execute(false, { cursor: memoryCursor() })).recordsDeleted).toBe(1);
    expect(await countRows(m)).toBe(1);
  });

  it("deletes a passed synthetic row's metadata without a storage call", async () => {
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_execution_id) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days', 'up', true, 'exec-up')`;
    await client`INSERT INTO reports (id, entity_type, entity_id, report_path) VALUES (uuidv7(), 'monitor', 'exec-up', 'exec-up/report')`;
    const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 1 }));
    expect(mockDeleteReports).not.toHaveBeenCalled();
    expect(await client`SELECT entity_id FROM reports`).toEqual([]);
  });

  it("a monitor that fails keeps its rows and makes the run partial (not failed), while other organizations are still cleaned", async () => {
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.pro}, now() - interval '40 days', 'up', true, 's3://bucket/x')`;
    await addResults(monitorOf.plus, 20, 3);
    mockDeleteReports.mockRejectedValueOnce(new Error("storage unreachable"));
    const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(result.success).toBe(true); // retried by the next hourly run, not by failing this one
    expect(result.details).toEqual(expect.objectContaining({ partial: true, failedMonitors: 1 }));
    expect(result.errors).toEqual(["storage unreachable"]);
    expect(await countRows(monitorOf.pro)).toBe(1);
    expect(await countRows(monitorOf.plus)).toBe(0);
  });

  it("caps each organization per run without starving the next one, and reports the lag of the capped class", async () => {
    await addResults(monitorOf.pro, 40, 2500); // heavy
    await addResults(monitorOf.plus, 10, 10); // light, visited after the heavy one
    const cursor = memoryCursor();
    const run = () => resultsStrategy({ maxRecordsPerRun: 1000 }).execute(false, { cursor });

    const first = await run();
    expect(first.recordsDeleted).toBe(1010);
    expect(first.details.perOrgStats).toEqual(
      expect.objectContaining({ [ORG.pro]: expect.objectContaining({ deleted: 1000, capped: true }) }),
    );
    expect(await countRows(monitorOf.plus)).toBe(0);
    expect(await countRows(monitorOf.pro)).toBe(1500);
    expect(mockReportProblem).toHaveBeenCalledWith(
      expect.stringContaining("30-day class"),
      ["retention-lag", "monitor_results", "30"],
      expect.objectContaining({ retentionDays: 30, organizations: 1 }),
    );
    expect(first.details.lag).toEqual(expect.arrayContaining([expect.objectContaining({ retentionDays: 30, lagDays: expect.any(Number) })]));

    expect((await run()).recordsDeleted).toBe(1000);
    expect((await run()).recordsDeleted).toBe(500);
    mockReportProblem.mockClear();
    expect((await run()).recordsDeleted).toBe(0);
    expect(mockReportProblem).not.toHaveBeenCalled();
  });

  it("a run out of budget returns success with partial, and the next run resumes after the last finished organization", async () => {
    // Pro (first) finishes fast; Plus has an artifact whose storage call outlasts the budget.
    await addResults(monitorOf.pro, 40, 5);
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days', 'up', true, 's3://bucket/slow')`;
    await addResults(monitorOf.trial, 20, 3);
    mockDeleteReports.mockImplementationOnce(async (inputs: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return { success: true, deletedObjects: inputs, failedObjects: [] };
    });
    const cursor = memoryCursor();

    const partial = await resultsStrategy({}, { timeBudgetMs: 1500 }).execute(false, { cursor });
    expect(partial.success).toBe(true);
    expect(partial.details).toEqual(expect.objectContaining({ partial: true, stopReason: "budget", organizationsProcessed: 1 }));
    expect(cursor.value).toBe(ORG.pro);
    expect(await countRows(monitorOf.trial)).toBe(3); // not reached

    // Pro gets new work: a run that ignored the cursor would visit Pro first.
    await addResults(monitorOf.pro, 40, 2);
    const order: string[] = [];
    const execute = mockDatabase.execute.bind(mockDatabase);
    const spy = jest.spyOn(mockDatabase, "execute").mockImplementation((async (query: Parameters<typeof execute>[0]) => {
      const rows = await execute(query);
      const text = JSON.stringify(query);
      if (text.includes("DELETE FROM monitor_results") && rows.length > 0) {
        order.push(Object.entries(monitorOf).find(([, id]) => text.includes(id))?.[0] ?? "?");
      }
      return rows;
    }) as unknown as typeof mockDatabase.execute);
    try {
      const resumed = await resultsStrategy().execute(false, { cursor });
      expect(resumed.details.partial).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(order[0]).toBe("trial"); // resumed after Pro, which comes last
    expect(order.at(-1)).toBe("pro");
    expect(await countRows(monitorOf.trial)).toBe(0);
    expect(cursor.value).toBeNull();
  });

  it("an organization out of its share of the budget is passed over so the next one is still cleaned", async () => {
    for (const offset of [1, 2, 3, 4]) {
      await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.pro}, now() - interval '40 days' - make_interval(secs => ${offset}), 'up', true, ${`s3://bucket/slow-${offset}`})`;
    }
    await addResults(monitorOf.plus, 20, 3);
    mockDeleteReports.mockImplementation(async (inputs: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { success: true, deletedObjects: inputs, failedObjects: [] };
    });
    const cursor = memoryCursor();
    // Budget 4 s, so each organization gets 1 s: two slow batches for Pro, then Plus.
    const result = await resultsStrategy({ batchSize: 1 }, { timeBudgetMs: 4000 }).execute(false, { cursor });
    expect(result.details.partial).toBe(false);
    expect(result.details.perOrgStats).toEqual(expect.objectContaining({ [ORG.pro]: expect.objectContaining({ capped: true }) }));
    expect(await countRows(monitorOf.pro)).toBeGreaterThan(0);
    expect(await countRows(monitorOf.plus)).toBe(0);
  }, 30_000);

  it("leaves rows another transaction holds and still finishes the run", async () => {
    await addResults(monitorOf.plus, 20, 3);
    const holder = postgres(dbUrl, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holding = holder.begin(async (tx) => {
      await tx`SELECT id FROM monitor_results WHERE monitor_id = ${monitorOf.plus} ORDER BY checked_at LIMIT 1 FOR UPDATE`;
      locked();
      await held;
    });
    await isLocked;
    try {
      const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
      expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 2 }));
      expect(await countRows(monitorOf.plus)).toBe(1);
    } finally {
      release();
      await holding;
      await holder.end({ timeout: 5 });
    }
    expect((await resultsStrategy().execute(false, { cursor: memoryCursor() })).recordsDeleted).toBe(1);
  });

  it("a lock lost after a deleted batch stops at the next batch and keeps the rest", async () => {
    await addResults(monitorOf.pro, 40, 5);
    const controller = new AbortController();
    const execute = mockDatabase.execute.bind(mockDatabase);
    // Awaited once: a drizzle raw query runs again on every then().
    const spy = jest.spyOn(mockDatabase, "execute").mockImplementation((async (query: Parameters<typeof execute>[0]) => {
      const rows = await execute(query);
      // The lock is lost right after the first batch that removed rows.
      if (JSON.stringify(query).includes("DELETE FROM monitor_results") && rows.length > 0) controller.abort();
      return rows;
    }) as unknown as typeof mockDatabase.execute);
    const cursor = memoryCursor();
    try {
      const result = await resultsStrategy({ batchSize: 2 }).execute(false, { cursor, signal: controller.signal });
      expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 2 }));
      expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "lock" }));
    } finally {
      spy.mockRestore();
    }
    expect(await countRows(monitorOf.pro)).toBe(3);
    expect(cursor.value).toBeNull();
  });

  it("an artifact whose storage delete keeps failing is retried each run while the monitor's plain rows go", async () => {
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days', 'up', true, 's3://bucket/denied')`;
    await addResults(monitorOf.plus, 20, 3);
    mockDeleteReports.mockImplementation(async (inputs: Array<{ entityId: string }>) => {
      mockFailedIds.mockReturnValue(new Set(inputs.map((i) => i.entityId)));
      return { success: false, deletedObjects: [], failedObjects: inputs };
    });
    for (let run = 0; run < 2; run++) {
      const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
      expect(result.success).toBe(true);
      expect(await countRows(monitorOf.plus)).toBe(1);
    }
    expect(mockDeleteReports).toHaveBeenCalledTimes(2);
  });

  it("artifact rows whose storage delete fails do not use up the cap, so a later monitor still gets it", async () => {
    // A second Plus monitor, created after the first so it is visited second.
    const [second] = await client`
      INSERT INTO monitors (id, organization_id, project_id, name, type, target, status)
      SELECT uuidv7(), organization_id, project_id, 'second', 'http_request', 'https://example.com', 'up' FROM monitors WHERE id = ${monitorOf.plus}
      RETURNING id`;
    for (const offset of [1, 2, 3]) {
      await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days' - make_interval(secs => ${offset}), 'up', true, ${`s3://bucket/denied-${offset}`})`;
    }
    await addResults(second.id, 20, 2);
    mockDeleteReports.mockImplementation(async (inputs: Array<{ entityId: string }>) => {
      mockFailedIds.mockReturnValue(new Set(inputs.map((i) => i.entityId)));
      return { success: false, deletedObjects: [], failedObjects: inputs };
    });
    const result = await resultsStrategy({ maxRecordsPerRun: 2, batchSize: 1 }).execute(false, { cursor: memoryCursor() });
    expect(mockDeleteReports).toHaveBeenCalledTimes(3); // every refused row was tried
    expect(result.recordsDeleted).toBe(2); // and the cap of 2 was still there for the second monitor
    expect(await countRows(monitorOf.plus)).toBe(3);
    expect(await countRows(second.id)).toBe(0);
  });


  it("a refused report does not block the healthy reports behind it or the monitor's plain rows", async () => {
    // The oldest report is refused on every run; the newer one is healthy.
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days' - interval '1 hour', 'up', true, 's3://bucket/refused')`;
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days', 'up', true, 's3://bucket/healthy')`;
    await addResults(monitorOf.plus, 20, 2);
    mockDeleteReports.mockImplementation(async (inputs: Array<{ entityId: string; s3Url?: string }>) => {
      const refused = inputs.filter((i) => i.s3Url === "s3://bucket/refused");
      mockFailedIds.mockReturnValue(new Set(refused.map((i) => i.entityId)));
      return { success: refused.length === 0, deletedObjects: inputs.filter((i) => !refused.includes(i)), failedObjects: refused };
    });
    for (let run = 0; run < 2; run++) {
      const result = await resultsStrategy({ batchSize: 1 }).execute(false, { cursor: memoryCursor() });
      expect(result.success).toBe(true);
    }
    const left = await client`SELECT test_report_s3_url FROM monitor_results WHERE monitor_id = ${monitorOf.plus}`;
    expect(left).toEqual([{ test_report_s3_url: "s3://bucket/refused" }]);
  });


  it("writes nothing for a batch whose lock was lost while storage answered", async () => {
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${monitorOf.plus}, now() - interval '20 days', 'up', true, 's3://bucket/slow')`;
    const controller = new AbortController();
    mockDeleteReports.mockImplementation(async (inputs: unknown[]) => {
      controller.abort();
      return { success: true, deletedObjects: inputs, failedObjects: [] };
    });
    const result = await resultsStrategy().execute(false, { cursor: memoryCursor(), signal: controller.signal });
    expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "lock" }));
    expect(await countRows(monitorOf.plus)).toBe(1);
  });

  it("a run whose lock is lost stops before deleting and leaves the cursor to the new owner", async () => {
    await addResults(monitorOf.plus, 20, 5);
    const controller = new AbortController();
    controller.abort();
    const cursor = memoryCursor(ORG.pro);
    const result = await resultsStrategy().execute(false, { cursor, signal: controller.signal });
    expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 0 }));
    expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "lock" }));
    expect(cursor.value).toBe(ORG.pro);
    expect(await countRows(monitorOf.plus)).toBe(5);
  });

  it("a dry run counts what would go and changes nothing", async () => {
    await addResults(monitorOf.plus, 20, 4);
    await addResults(monitorOf.plus, 20, 1, { statusChange: true });
    const cursor = memoryCursor(ORG.pro);
    const result = await resultsStrategy().execute(true, { cursor });
    expect(result.recordsDeleted).toBe(4);
    expect(await countRows(monitorOf.plus)).toBe(5);
    expect(cursor.value).toBe(ORG.pro);
  });

  it("a failed lag check is logged and does not fail the run", async () => {
    await addResults(monitorOf.plus, 20, 2);
    const execute = mockDatabase.execute.bind(mockDatabase);
    const spy = jest.spyOn(mockDatabase, "execute").mockImplementation(((query: Parameters<typeof execute>[0]) => {
      const text = JSON.stringify(query);
      return text.includes("CROSS JOIN LATERAL") ? Promise.reject(new Error("lag query failed")) : execute(query);
    }) as unknown as typeof mockDatabase.execute);
    try {
      const result = await resultsStrategy().execute(false, { cursor: memoryCursor() });
      expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 2 }));
      expect(result.details.lag).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("estimates table size from planner statistics", async () => {
    await addResults(monitorOf.plus, 20, 50);
    await client`ANALYZE monitor_results`;
    const stats = await resultsStrategy().getStats();
    expect(stats.totalRecords).toBeGreaterThan(0);
    expect(stats.oldRecords).toBeGreaterThan(0);
  });
});

describe("raw cleanup and the daily rollup", () => {
  afterEach(() => jest.useRealTimers());
  // Only Date is faked: the database driver keeps its real timers.
  const at = (ms: number) =>
    jest.useFakeTimers({ now: ms, doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "hrtime", "performance"] });
  const daily = async (monitorId: string, dayStart: Date) =>
    client`SELECT location, total_checks, successful_checks, uptime_percentage::text AS uptime FROM monitor_aggregates
           WHERE monitor_id = ${monitorId} AND period_type = 'daily' AND period_start = ${dayStart.toISOString()} ORDER BY location NULLS FIRST`;

  it("deletes whole UTC days only, so the hourly cleanup before the 00:15 rollup never shrinks the oldest day of a 7-day organization", async () => {
    const DAY = 86_400_000;
    const dayC = Math.floor(Date.now() / DAY) * DAY; // day C, UTC midnight
    const dayC7 = new Date(dayC - 7 * DAY);
    const m = monitorOf.plus; // Plus: 7 days raw
    // Day C-7: one check an hour, the first four hours down; plus a day older than the window.
    await client`
      INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, details)
      SELECT uuidv7(), ${m}, ${dayC7.toISOString()}::timestamptz + make_interval(hours => h, mins => 5),
             CASE WHEN h < 4 THEN 'down' ELSE 'up' END, h >= 4, '{}'::jsonb
      FROM generate_series(0, 23) h`;
    await client`UPDATE monitor_results SET is_status_change = true WHERE monitor_id = ${m} AND checked_at IN (${new Date(dayC7.getTime() + 5 * 60_000).toISOString()}::timestamptz, ${new Date(dayC7.getTime() + 4 * 3_600_000 + 5 * 60_000).toISOString()}::timestamptz)`;
    // A plain down check at 00:20 that a cutoff of "now minus 7 days" would delete at 00:30.
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, details) VALUES (uuidv7(), ${m}, ${new Date(dayC7.getTime() + 20 * 60_000).toISOString()}, 'down', false, '{}'::jsonb)`;
    await addResults(m, 9, 3);

    at(dayC - DAY + 15 * 60_000); // day C-1 00:15: the rollup sees all of C-7
    expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
    const before = await daily(m, dayC7);
    expect(before.find((row) => row.location === null)).toEqual(expect.objectContaining({ total_checks: 25, successful_checks: 20 }));

    at(dayC + 30 * 60_000); // day C 00:30: hourly cleanup, then the daily rollup
    const cleanup = await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(cleanup.recordsDeleted).toBe(3); // only the older day
    expect(Number((await client`SELECT count(*)::int AS n FROM monitor_results WHERE monitor_id = ${m} AND checked_at >= ${dayC7.toISOString()}::timestamptz`)[0].n)).toBe(25);
    expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
    expect(await daily(m, dayC7)).toEqual(before);

    at(dayC + DAY + 30 * 60_000); // day C+1: C-7 leaves both the window and the rollup lookback
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(await daily(m, dayC7)).toEqual(before);
  });
});

describe("rollup over days that cleanup purged around a kept row", () => {
  afterEach(async () => {
    jest.useRealTimers();
    await client`UPDATE plan_limits SET data_retention_days = 7 WHERE plan = 'plus'`;
  });
  const at = (ms: number) =>
    jest.useFakeTimers({ now: ms, doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "hrtime", "performance"] });

  it("never rewrites a purged day of a 3-day organization because a refused report older than it survived", async () => {
    await client`UPDATE plan_limits SET data_retention_days = 3 WHERE plan = 'plus'`;
    const DAY = 86_400_000;
    const dayC = Math.floor(Date.now() / DAY) * DAY;
    const dayC4 = new Date(dayC - 4 * DAY);
    const dayC5 = new Date(dayC - 5 * DAY);
    const m = monitorOf.plus;
    // Day C-5: a report storage will refuse. Day C-4: twelve checks, four down, and one status change.
    await client`INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, test_report_s3_url) VALUES (uuidv7(), ${m}, ${new Date(dayC5.getTime() + 3_600_000).toISOString()}, 'up', true, 's3://bucket/refused')`;
    await client`
      INSERT INTO monitor_results (id, monitor_id, checked_at, status, is_up, is_status_change, details)
      SELECT uuidv7(), ${m}, ${dayC4.toISOString()}::timestamptz + make_interval(hours => h * 2, mins => 5),
             CASE WHEN h < 4 THEN 'down' ELSE 'up' END, h >= 4, h = 0, '{}'::jsonb
      FROM generate_series(0, 11) h`;

    at(dayC - 2 * DAY + 15 * 60_000); // C-2 00:15: C-4 is inside the window and complete
    expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
    const daily = async () =>
      client`SELECT total_checks, successful_checks FROM monitor_aggregates WHERE monitor_id = ${m} AND period_type = 'daily' AND location IS NULL AND period_start = ${dayC4.toISOString()}`;
    const before = await daily();
    expect(before).toEqual([{ total_checks: 12, successful_checks: 8 }]);

    at(dayC + 30 * 60_000); // C 00:30: cleanup purges C-4 except the status change; the C-5 report is refused
    mockDeleteReports.mockImplementation(async (inputs: Array<{ entityId: string }>) => {
      mockFailedIds.mockReturnValue(new Set(inputs.map((i) => i.entityId)));
      return { success: false, deletedObjects: [], failedObjects: inputs };
    });
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(Number((await client`SELECT count(*)::int AS n FROM monitor_results WHERE monitor_id = ${m}`)[0].n)).toBe(2);
    expect((await monitorAggregationService.runDailyAggregation()).errors).toEqual([]);
    expect(await daily()).toEqual(before);
  });
});

describe("raw purge watermark (monitors.raw_purged_before)", () => {
  afterEach(async () => {
    jest.useRealTimers();
    await client`UPDATE plan_limits SET data_retention_days = 7 WHERE plan = 'plus'`;
  });
  const at = (ms: number) =>
    jest.useFakeTimers({ now: ms, doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "hrtime", "performance"] });
  const watermark = async (monitorId: string) =>
    (await client`SELECT raw_purged_before, xmin::text AS version FROM monitors WHERE id = ${monitorId}`)[0] as { raw_purged_before: Date | null; version: string };

  it("moves to the cutoff's UTC midnight, never back when the window grows, and only when the cutoff advances; a dry run and a skipped organization leave it", async () => {
    const DAY = 86_400_000;
    const dayC = Math.floor(Date.now() / DAY) * DAY;
    at(dayC + 12 * 3_600_000);
    await client`UPDATE plan_limits SET data_retention_days = 3 WHERE plan = 'plus'`;
    await addResults(monitorOf.plus, 5, 2);

    // A dry run counts only.
    expect((await resultsStrategy().execute(true, { cursor: memoryCursor() })).recordsDeleted).toBe(2);
    expect((await watermark(monitorOf.plus)).raw_purged_before).toBeNull();

    // 3-day window: the watermark is the cutoff, the UTC midnight three days back. The skipped organization has none.
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    const threeDays = new Date(dayC - 3 * DAY);
    const first = await watermark(monitorOf.plus);
    expect(first.raw_purged_before).toEqual(threeDays);
    expect((await watermark(monitorOf.pro)).raw_purged_before).toEqual(new Date(dayC - 30 * DAY));
    expect((await watermark(monitorOf.billing)).raw_purged_before).toBeNull();

    // The next hourly run has the same cutoff: the row is not written again.
    at(dayC + 13 * 3_600_000);
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect(await watermark(monitorOf.plus)).toEqual(first);

    // A longer window (7 days) has an earlier cutoff; the rows before the old one are gone, so the watermark stays.
    await client`UPDATE plan_limits SET data_retention_days = 7 WHERE plan = 'plus'`;
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect((await watermark(monitorOf.plus)).raw_purged_before).toEqual(threeDays);

    // A dry run with a shorter window (1 day) does not move it either; a real run with that window does.
    await client`UPDATE plan_limits SET data_retention_days = 1 WHERE plan = 'plus'`;
    await resultsStrategy().execute(true, { cursor: memoryCursor() });
    expect((await watermark(monitorOf.plus)).raw_purged_before).toEqual(threeDays);
    await resultsStrategy().execute(false, { cursor: memoryCursor() });
    expect((await watermark(monitorOf.plus)).raw_purged_before).toEqual(new Date(dayC - DAY));
  });
});

describe("monitor_aggregates", () => {
  const aggregatesStrategy = (maxRecordsPerRun = 100_000) =>
    new MonitorAggregatesCleanupStrategy({
      entityType: "monitor_aggregates",
      enabled: true,
      cronSchedule: "30 2 * * *",
      retentionDays: 365,
      batchSize: 2,
      maxRecordsPerRun,
      customConfig: { pauseMs: 0 },
    });
  async function addAggregate(monitorId: string, periodType: "hourly" | "daily", ageDays: number) {
    await client`
      INSERT INTO monitor_aggregates (id, monitor_id, period_type, period_start, total_checks, uptime_percentage)
      VALUES (uuidv7(), ${monitorId}, ${periodType}, date_trunc('hour', now()) - make_interval(days => ${ageDays}), 1, 100)`;
  }
  const kept = async (monitorId: string) =>
    (await client`SELECT period_type, round(extract(epoch FROM now() - period_start) / 86400)::int AS age FROM monitor_aggregates WHERE monitor_id = ${monitorId} ORDER BY period_type, period_start DESC`).map(
      (r) => `${r.period_type}:${r.age}`,
    );

  it("keeps hourly rows for the plan's window and daily rows at least 90 days, in batches; a rerun is a no-op", async () => {
    for (const age of [10, 40]) await addAggregate(monitorOf.plus, "hourly", age);
    for (const age of [40, 80, 100]) await addAggregate(monitorOf.plus, "daily", age);
    for (const age of [80, 100, 101, 102]) await addAggregate(monitorOf.pro, "hourly", age);
    for (const age of [100, 200]) await addAggregate(monitorOf.pro, "daily", age);

    const result = await aggregatesStrategy().execute();
    expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 7 }));
    expect(await kept(monitorOf.plus)).toEqual(["daily:40", "daily:80", "hourly:10"]); // Plus: hourly 30, daily 90
    expect(await kept(monitorOf.pro)).toEqual(["hourly:80"]); // Pro: hourly 90, daily 90
    expect((await aggregatesStrategy().execute()).recordsDeleted).toBe(0);
  });

  it("stops an organization at its cap and finishes on the next run", async () => {
    for (const age of [100, 101, 102, 103, 104]) await addAggregate(monitorOf.plus, "daily", age);
    expect((await aggregatesStrategy(3).execute()).recordsDeleted).toBe(3);
    expect((await aggregatesStrategy(3).execute()).recordsDeleted).toBe(2);
    expect(await kept(monitorOf.plus)).toEqual([]);
  });

  it("a lock lost mid-organization stops after the current batch and reports partial", async () => {
    for (const age of [100, 101, 102, 103, 104]) await addAggregate(monitorOf.pro, "daily", age); // first organization
    const controller = new AbortController();
    const execute = mockDatabase.execute.bind(mockDatabase);
    // Awaited once: a drizzle raw query runs again on every then().
    const spy = jest.spyOn(mockDatabase, "execute").mockImplementation((async (query: Parameters<typeof execute>[0]) => {
      const rows = await execute(query);
      // The lock is lost right after the first batch that removed rows.
      if (JSON.stringify(query).includes("DELETE FROM monitor_aggregates") && rows.length > 0) controller.abort();
      return rows;
    }) as unknown as typeof mockDatabase.execute);
    try {
      const result = await aggregatesStrategy().execute(false, { signal: controller.signal });
      expect(result).toEqual(expect.objectContaining({ success: true, recordsDeleted: 2 }));
      expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "lock" }));
    } finally {
      spy.mockRestore();
    }
  });

  it("an organization that fails is reported, the run is partial, and the others are still cleaned", async () => {
    await addAggregate(monitorOf.pro, "daily", 100);
    await addAggregate(monitorOf.plus, "daily", 100);
    const original = monitorAggregationService.cleanupOldAggregatesForOrg.bind(monitorAggregationService);
    const spy = jest.spyOn(monitorAggregationService, "cleanupOldAggregatesForOrg").mockImplementation((orgId, ...rest) =>
      orgId === ORG.pro ? Promise.reject(new Error("boom")) : original(orgId, ...rest),
    );
    const execute = mockDatabase.execute.bind(mockDatabase);
    let lagQueries = 0;
    const lagSpy = jest.spyOn(mockDatabase, "execute").mockImplementation(((query: Parameters<typeof execute>[0]) => {
      if (JSON.stringify(query).includes("LEFT JOIN LATERAL")) lagQueries++;
      return execute(query);
    }) as unknown as typeof mockDatabase.execute);
    try {
      const result = await aggregatesStrategy().execute();
      expect(result.success).toBe(true);
      expect(result.details).toEqual(expect.objectContaining({ partial: true, failedOrganizations: 1 }));
      expect(result.errors).toEqual([expect.stringContaining("boom")]);
      expect(result.recordsDeleted).toBe(1);
      expect(result.details.lag).toBeUndefined();
      expect(lagQueries).toBe(0); // a partial run skips the lag query
      expect(await kept(monitorOf.pro)).toEqual(["daily:100"]);
    } finally {
      spy.mockRestore();
      lagSpy.mockRestore();
    }
  });

  it("refuses a window that is not a positive number of days", async () => {
    await expect(monitorAggregationService.cleanupOldAggregatesForOrg(ORG.plus, 0, 90)).rejects.toThrow("Invalid aggregate retention");
  });

  it("resumes after the last finished organization and passes over one that uses up its share of the budget", async () => {
    for (const age of [100, 101, 102, 103, 104, 105]) await addAggregate(monitorOf.pro, "daily", age);
    await addAggregate(monitorOf.plus, "daily", 100);
    const cursor = memoryCursor(ORG.pro);
    const strategy = new MonitorAggregatesCleanupStrategy({
      entityType: "monitor_aggregates", enabled: true, cronSchedule: "30 2 * * *", retentionDays: 365, batchSize: 1,
      maxRecordsPerRun: 100_000, customConfig: { pauseMs: 400, timeBudgetMs: 4000 },
    });
    const result = await strategy.execute(false, { cursor });
    // Plus first (after the cursor), then Pro, which stops after its 1 s share.
    expect(await kept(monitorOf.plus)).toEqual([]);
    expect((await kept(monitorOf.pro)).length).toBeGreaterThan(0);
    expect(result.details.partial).toBe(false);
    expect(result.details.perOrgStats).toEqual(expect.objectContaining({ [ORG.pro]: expect.objectContaining({ capped: true }) }));
    expect(cursor.value).toBeNull();
  }, 30_000);

  it("a run out of budget saves the last finished organization", async () => {
    await addAggregate(monitorOf.pro, "daily", 100);
    await addAggregate(monitorOf.plus, "daily", 100);
    const cursor = memoryCursor();
    const original = monitorAggregationService.cleanupOldAggregatesForOrg.bind(monitorAggregationService);
    const spy = jest.spyOn(monitorAggregationService, "cleanupOldAggregatesForOrg").mockImplementation(async (...args) => {
      const outcome = await original(...args);
      await new Promise((resolve) => setTimeout(resolve, 1200)); // the first organization takes the whole budget
      return outcome;
    });
    try {
      const strategy = new MonitorAggregatesCleanupStrategy({
        entityType: "monitor_aggregates", enabled: true, cronSchedule: "30 2 * * *", retentionDays: 365,
        customConfig: { pauseMs: 0, timeBudgetMs: 1000 },
      });
      const result = await strategy.execute(false, { cursor });
      expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "budget" }));
      expect(cursor.value).toBe(ORG.pro);
      expect(await kept(monitorOf.plus)).toEqual(["daily:100"]);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  it("a dry run counts without deleting", async () => {
    await addAggregate(monitorOf.plus, "hourly", 40);
    await addAggregate(monitorOf.plus, "daily", 100);
    expect((await aggregatesStrategy().execute(true)).recordsDeleted).toBe(2);
    expect((await aggregatesStrategy(1).execute(true)).recordsDeleted).toBe(1); // what one run can remove
    expect(await kept(monitorOf.plus)).toHaveLength(2);
  });

  it("a lost lock stops before any delete and reports partial", async () => {
    await addAggregate(monitorOf.plus, "daily", 100);
    const controller = new AbortController();
    controller.abort();
    const result = await aggregatesStrategy().execute(false, { signal: controller.signal });
    expect(result.details).toEqual(expect.objectContaining({ partial: true, stopReason: "lock" }));
    expect(await kept(monitorOf.plus)).toHaveLength(1);
  });

  it("estimates table size from planner statistics", async () => {
    await addAggregate(monitorOf.plus, "daily", 100);
    await client`ANALYZE monitor_aggregates`;
    expect((await aggregatesStrategy().getStats()).totalRecords).toBeGreaterThan(0);
  });
});

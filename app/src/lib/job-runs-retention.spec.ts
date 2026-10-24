/** @jest-environment node */

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { jobs, organization, planLimits, runs } from "@/db/schema";

const DAY = 86_400_000;
const whereCalls: Array<{ table: unknown; condition: SQL }> = [];
let isPolar = true;
let noOrganizations = false;

const rowsFor = (table: unknown, condition?: SQL): unknown[] => {
  if (table === organization) {
    if (noOrganizations) return [];
    return isPolar
      ? [
          { organizationId: "org-plus", subscriptionPlan: "plus" },
          { organizationId: "org-pro", subscriptionPlan: "pro" },
        ]
      : [{ id: "org-self-hosted" }];
  }
  if (table === planLimits) {
    // Self-hosted looks up the unlimited plan with a where clause.
    if (condition) return [{ plan: "unlimited", jobDataRetentionDays: 120 }];
    return [
      { plan: "plus", jobDataRetentionDays: 30 },
      { plan: "pro", jobDataRetentionDays: 90 },
    ];
  }
  if (table === jobs) return [{ id: "job-1" }];
  if (table === runs && condition) return [{ count: 2 }];
  return [];
};

jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          whereCalls.push({ table, condition });
          const rows = rowsFor(table, condition);
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
        then: (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(rowsFor(table)).then(resolve),
      }),
    }),
  },
}));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({}) }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => isPolar }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));

import { JobRunsCleanupStrategy } from "./data-lifecycle-service";

const config = {
  entityType: "job_runs" as const,
  cronSchedule: "0 * * * *",
  enabled: true,
  retentionDays: 30,
  batchSize: 100,
};

// The age cutoff bound into `runs.created_at < $n`, as days before now.
const cutoffDays = (condition: SQL): number => {
  const { params } = new PgDialect().sqlToQuery(condition);
  const cutoff = params
    .map((param) => (typeof param === "string" && /^\d{4}-\d{2}-\d{2}T/.test(param) ? Date.parse(param) : NaN))
    .find((time) => Number.isFinite(time));
  if (cutoff === undefined) throw new Error("no cutoff parameter");
  return Math.round((Date.now() - cutoff) / DAY);
};

describe("JobRunsCleanupStrategy retention (dry run)", () => {
  beforeEach(() => {
    whereCalls.length = 0;
    isPolar = true;
    noOrganizations = false;
  });

  it("applies each organization's plan retention and a 24 hour cutoff to standalone runs", async () => {
    const result = await new JobRunsCleanupStrategy(config).execute(true);
    const runConditions = whereCalls.filter((call) => call.table === runs).map((call) => call.condition);

    expect(result.success).toBe(true);
    // Plus org, Pro org, then standalone (jobId IS NULL) runs.
    expect(runConditions.map(cutoffDays)).toEqual([30, 90, 1]);
    expect(new PgDialect().sqlToQuery(runConditions[0]).sql).toContain('"runs"."job_id" in');
    expect(new PgDialect().sqlToQuery(runConditions[2]).sql).toContain('"runs"."job_id" IS NULL');
    expect(result.details.orgStats).toMatchObject({
      "org-plus": { retentionDays: 30 },
      "org-pro": { retentionDays: 90 },
    });
    expect(result.details.playgroundRunsDeleted).toBe(2);
  });

  it("only expires terminal standalone runs after their completion age", async () => {
    await new JobRunsCleanupStrategy(config).execute(true);
    const condition = whereCalls.filter(call => call.table === runs).at(-1)!.condition;
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(sql).toContain('"runs"."status" in');
    expect(params).toEqual(expect.arrayContaining(["passed", "failed", "error", "blocked"]));
    expect(params).not.toEqual(expect.arrayContaining(["queued", "running"]));
    expect(sql).toContain('coalesce("runs"."completed_at", "runs"."created_at")');
  });

  it("uses the configured playground age independently of the job plan", async () => {
    await new JobRunsCleanupStrategy({ ...config, customConfig: { playgroundMaxAgeHours: 48 } }).execute(true);
    const conditions = whereCalls.filter(call => call.table === runs).map(call => call.condition);
    expect(conditions.map(cutoffDays)).toEqual([30, 90, 2]);
  });

  it("keeps standalone retention when no organizations remain", async () => {
    noOrganizations = true;
    await new JobRunsCleanupStrategy(config).execute(true);
    const conditions = whereCalls.filter(call => call.table === runs).map(call => call.condition);
    expect(conditions.map(cutoffDays)).toEqual([30, 1]);
    expect(new PgDialect().sqlToQuery(conditions[0]).sql).toContain('"runs"."job_id" IS NOT NULL');
    expect(new PgDialect().sqlToQuery(conditions[1]).sql).toContain('"runs"."job_id" IS NULL');
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid playground retention %s", playgroundMaxAgeHours => {
    expect(() => new JobRunsCleanupStrategy({ ...config, customConfig: { playgroundMaxAgeHours } })).toThrow();
  });

  it("uses the unlimited plan retention for every self-hosted organization", async () => {
    isPolar = false;
    const result = await new JobRunsCleanupStrategy(config).execute(true);
    const runConditions = whereCalls.filter((call) => call.table === runs).map((call) => call.condition);

    expect(result.details.orgStats).toMatchObject({ "org-self-hosted": { retentionDays: 120 } });
    expect(cutoffDays(runConditions[0])).toBe(120);
  });
});

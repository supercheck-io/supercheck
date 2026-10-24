/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Table = object;
const tableRows = new Map<Table, unknown[]>();
const entitlementWhere: SQL[] = [];
let entitlementFailure: Error | null = null;

jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true }));
jest.mock("@/lib/monitor-aggregation-service", () => ({ monitorAggregationService: {} }));
jest.mock("@/utils/db", () => {
  const schema = jest.requireActual("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: Table) => {
          const result = () =>
            table === schema.executionEntitlements && entitlementFailure
              ? Promise.reject(entitlementFailure)
              : Promise.resolve(tableRows.get(table) ?? []);
          return Object.assign(result(), {
            where: (condition: SQL) => {
              if (table === schema.executionEntitlements) entitlementWhere.push(condition);
              return result();
            },
          });
        },
      }),
    },
  };
});

import { executionEntitlements, organization, planLimits } from "@/db/schema";
import { TRIAL_RETENTION } from "@/lib/execution/trial-limits";
import {
  getOrganizationAggregatedRetentionSettings,
  getOrganizationJobRetentionSettings,
  getOrganizationRetentionSettings,
} from "./data-lifecycle-service";

const FALLBACK = { raw: 90, aggregated: 365, job: 180 };
const plus = { plan: "plus", dataRetentionDays: 30, aggregatedDataRetentionDays: 180, jobDataRetentionDays: 120 };

function seed(orgs: Array<{ organizationId: string; subscriptionPlan: string | null }>, trialOrgIds: string[]) {
  tableRows.set(organization, orgs);
  tableRows.set(planLimits, [plus]);
  tableRows.set(executionEntitlements, trialOrgIds.map((organizationId) => ({ organizationId })));
}

beforeEach(() => {
  tableRows.clear();
  entitlementWhere.length = 0;
  entitlementFailure = null;
});

const bySetting = async () => ({
  raw: new Map((await getOrganizationRetentionSettings(FALLBACK.raw)).map((o) => [o.organizationId, o.retentionDays])),
  aggregated: new Map(
    (await getOrganizationAggregatedRetentionSettings(FALLBACK.aggregated)).map((o) => [o.organizationId, o.aggregatedRetentionDays]),
  ),
  job: new Map((await getOrganizationJobRetentionSettings(FALLBACK.job)).map((o) => [o.organizationId, o.jobRetentionDays])),
});

describe("retention of trial organizations", () => {
  it("applies the trial retention to an organization on an active trial with no plan", async () => {
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    const result = await bySetting();
    expect(result.raw.get("trial")).toBe(TRIAL_RETENTION.dataRetentionDays);
    expect(result.aggregated.get("trial")).toBe(TRIAL_RETENTION.aggregatedDataRetentionDays);
    expect(result.job.get("trial")).toBe(TRIAL_RETENTION.jobDataRetentionDays);
    expect(TRIAL_RETENTION.dataRetentionDays).toBe(7);
  });

  it("keeps the default for an organization with no plan and no active trial, never a shorter period", async () => {
    seed([{ organizationId: "ended", subscriptionPlan: null }], []);
    const result = await bySetting();
    expect(result.raw.get("ended")).toBe(FALLBACK.raw);
    expect(result.aggregated.get("ended")).toBe(FALLBACK.aggregated);
    expect(result.job.get("ended")).toBe(FALLBACK.job);
  });

  it("uses the plan, not the trial, for an organization that has both", async () => {
    seed([{ organizationId: "paid", subscriptionPlan: "plus" }], ["paid"]);
    const result = await bySetting();
    expect(result.raw.get("paid")).toBe(30);
    expect(result.aggregated.get("paid")).toBe(180);
    expect(result.job.get("paid")).toBe(120);
  });

  it("selects only trials that have not expired", async () => {
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    await getOrganizationRetentionSettings(FALLBACK.raw);
    const { sql } = new PgDialect().sqlToQuery(entitlementWhere[0]);
    expect(sql).toContain('"expires_at" > $');
  });

  it.each([
    ["raw", () => getOrganizationRetentionSettings(FALLBACK.raw)],
    ["job", () => getOrganizationJobRetentionSettings(FALLBACK.job)],
  ])("skips %s cleanup rather than guessing when the trial lookup fails", async (_name, resolve) => {
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    entitlementFailure = new Error("database unavailable");
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(resolve()).rejects.toThrow("database unavailable");
  });

  it("returns no per-organization settings, not trial retention, when the trial lookup fails for aggregated data", async () => {
    // This resolver has always answered [] on a lookup error (the sweep then uses its global default).
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    entitlementFailure = new Error("database unavailable");
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getOrganizationAggregatedRetentionSettings(FALLBACK.aggregated)).resolves.toEqual([]);
  });
});

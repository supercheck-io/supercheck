/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Table = object;
const tableRows = new Map<Table, unknown[]>();
const entitlementWhere: SQL[] = [];
let entitlementFailure: Error | null = null;
let organizationFailure: Error | null = null;

let polarEnabled = true;
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => polarEnabled }));
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
              : table === schema.organization && organizationFailure
                ? Promise.reject(organizationFailure)
                : Promise.resolve(tableRows.get(table) ?? []);
          const chain = (promise: Promise<unknown[]>) =>
            Object.assign(promise, { orderBy: () => promise, limit: () => promise });
          return Object.assign(chain(result()), {
            where: (condition: SQL) => {
              if (table === schema.executionEntitlements) entitlementWhere.push(condition);
              return chain(result());
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
  SHORTEST_RAW_RETENTION_DAYS,
} from "./data-lifecycle-service";

const FALLBACK = { raw: 90, aggregated: 365, job: 180 };
const plus = { plan: "plus", dataRetentionDays: 30, aggregatedDataRetentionDays: 180, jobDataRetentionDays: 120 };

function seed(
  orgs: Array<{ organizationId: string; subscriptionPlan: string | null; subscriptionStatus?: string | null }>,
  trialOrgIds: string[],
  plans: Array<Record<string, unknown>> = [plus],
) {
  tableRows.set(organization, orgs);
  tableRows.set(planLimits, plans);
  tableRows.set(executionEntitlements, trialOrgIds.map((organizationId) => ({ organizationId })));
}

beforeEach(() => {
  polarEnabled = true;
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  tableRows.clear();
  entitlementWhere.length = 0;
  entitlementFailure = null;
  organizationFailure = null;
});

const bySetting = async () => ({
  raw: new Map((await getOrganizationRetentionSettings()).map((o) => [o.organizationId, o.retentionDays])),
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

  it("gives an organization with no plan and no active trial the shortest raw window, and the aggregate/job defaults", async () => {
    seed([{ organizationId: "ended", subscriptionPlan: null }], []);
    const result = await bySetting();
    expect(result.raw.get("ended")).toBe(SHORTEST_RAW_RETENTION_DAYS);
    expect(result.aggregated.get("ended")).toBe(FALLBACK.aggregated);
    expect(result.job.get("ended")).toBe(FALLBACK.job);
  });

  // Retention deletes data, so only an organization with no billing history at all is treated as a trial.
  it.each(["active", "past_due", "canceled", "none"])(
    "keeps the aggregate and job defaults for an organization that has a subscription status (%s) even while its trial row is unexpired",
    async (subscriptionStatus) => {
      // Just subscribed before the webhook set the plan, or a plan cleared by a cancellation or customer deletion.
      seed([{ organizationId: "billed", subscriptionPlan: null, subscriptionStatus }], ["billed"]);
      const result = await bySetting();
      expect(result.aggregated.get("billed")).toBe(FALLBACK.aggregated);
      expect(result.job.get("billed")).toBe(FALLBACK.job);
    },
  );

  it("uses the plan, not the trial, for an organization that has both", async () => {
    seed([{ organizationId: "paid", subscriptionPlan: "plus" }], ["paid"]);
    const result = await bySetting();
    expect(result.raw.get("paid")).toBe(30);
    expect(result.aggregated.get("paid")).toBe(180);
    expect(result.job.get("paid")).toBe(120);
  });

  it("selects only trials that have not expired", async () => {
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    await getOrganizationJobRetentionSettings(FALLBACK.job);
    const { sql } = new PgDialect().sqlToQuery(entitlementWhere[0]);
    expect(sql).toContain('"expires_at" > $');
  });

  it("skips job cleanup rather than guessing when the trial lookup fails", async () => {
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    entitlementFailure = new Error("database unavailable");
    await expect(getOrganizationJobRetentionSettings(FALLBACK.job)).rejects.toThrow("database unavailable");
  });

  it("skips raw cleanup rather than guessing when the organization lookup fails", async () => {
    tableRows.set(planLimits, [plus]);
    organizationFailure = new Error("database unavailable");
    await expect(getOrganizationRetentionSettings()).rejects.toThrow("database unavailable");
  });

  it("returns no per-organization settings, not trial retention, when the trial lookup fails for aggregated data", async () => {
    // This resolver has always answered [] on a lookup error (the sweep then uses its global default).
    seed([{ organizationId: "trial", subscriptionPlan: null }], ["trial"]);
    entitlementFailure = new Error("database unavailable");
    await expect(getOrganizationAggregatedRetentionSettings(FALLBACK.aggregated)).resolves.toEqual([]);
  });
});

describe("raw retention matrix", () => {
  const pro = { plan: "pro", dataRetentionDays: 30, aggregatedDataRetentionDays: 90, jobDataRetentionDays: 90 };
  const raw = async () => new Map((await getOrganizationRetentionSettings()).map((o) => [o.organizationId, o.retentionDays]));

  it("derives the shortest raw window from the trial retention in the catalog", () => {
    expect(SHORTEST_RAW_RETENTION_DAYS).toBe(TRIAL_RETENTION.dataRetentionDays);
  });

  it.each([
    ["plus", { subscriptionPlan: "plus" }, 30],
    ["pro", { subscriptionPlan: "pro" }, 30],
    ["active trial", { subscriptionPlan: null }, 7],
    ["ended trial or never subscribed", { subscriptionPlan: null, subscriptionStatus: null }, 7],
    ["canceled with the plan cleared", { subscriptionPlan: null, subscriptionStatus: "canceled" }, 7],
    ["status none", { subscriptionPlan: null, subscriptionStatus: "none" }, 7],
  ])("%s", async (_name, org, expected) => {
    seed([{ organizationId: "org", subscriptionStatus: null, ...org }], ["org"], [plus, pro]);
    expect((await raw()).get("org")).toBe(expected);
  });

  it("skips a paid plan that has no plan_limits row rather than applying the shortest window", async () => {
    seed([{ organizationId: "unknown", subscriptionPlan: "unlimited" }, { organizationId: "other", subscriptionPlan: "pro" }], [], [plus, pro]);
    const result = await raw();
    expect(result.has("unknown")).toBe(false);
    expect(result.get("other")).toBe(30);
  });

  it("uses a plan row of the plan, not a fallback, even when it is shorter than 7 days", async () => {
    seed([{ organizationId: "org", subscriptionPlan: "plus" }], [], [{ ...plus, dataRetentionDays: 3 }]);
    expect((await raw()).get("org")).toBe(3);
  });

  it.each(["active", "past_due"])("skips an organization whose subscription is %s while its plan is not set yet", async (subscriptionStatus) => {
    seed([{ organizationId: "billing", subscriptionPlan: null, subscriptionStatus }, { organizationId: "other", subscriptionPlan: "pro" }], [], [pro]);
    const result = await raw();
    expect(result.has("billing")).toBe(false);
    expect(result.get("other")).toBe(30);
  });

  it.each([0, -1])("skips an organization whose plan row says %s days instead of deleting everything", async (days) => {
    seed([{ organizationId: "zero", subscriptionPlan: "plus" }], [], [{ ...plus, dataRetentionDays: days, aggregatedDataRetentionDays: days, jobDataRetentionDays: days }]);
    const result = await bySetting();
    expect(result.raw.has("zero")).toBe(false);
    expect(result.aggregated.has("zero")).toBe(false);
    expect(result.job.has("zero")).toBe(false);
  });

  it("self-hosted uses the unlimited row for every organization", async () => {
    polarEnabled = false;
    tableRows.set(organization, [{ id: "a" }, { id: "b" }]);
    tableRows.set(planLimits, [{ dataRetentionDays: 14, aggregatedDataRetentionDays: 120, jobDataRetentionDays: 60 }]);
    const result = await bySetting();
    expect([...result.raw.values()]).toEqual([14, 14]);
    expect([...result.aggregated.values()]).toEqual([120, 120]);
    expect([...result.job.values()]).toEqual([60, 60]);
  });

  it("self-hosted without an unlimited row uses the shortest raw window", async () => {
    polarEnabled = false;
    tableRows.set(organization, [{ id: "a" }]);
    tableRows.set(planLimits, []);
    expect((await raw()).get("a")).toBe(SHORTEST_RAW_RETENTION_DAYS);
  });
});

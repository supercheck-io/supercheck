/** @jest-environment node */

const findOrg = jest.fn();
let polarEnabled = true;
let planRows: Record<string, number> = {};
const planLookups: string[] = [];
let planLookupError: Error | null = null;

jest.mock("@/utils/db", () => {
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
  return {
    db: {
      query: { organization: { findFirst: (...args: unknown[]) => findOrg(...args) } },
      select: () => ({
        from: () => ({
          where: (condition: unknown) => ({
            limit: async () => {
              if (planLookupError) throw planLookupError;
              const plan = String(new PgDialect().sqlToQuery(condition).params[0]);
              planLookups.push(plan);
              return plan in planRows ? [{ days: planRows[plan] }] : [];
            },
          }),
        }),
      }),
    },
  };
});
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => polarEnabled }));

import { getRawResultRetention } from "./monitor-result-retention";
import { SHORTEST_RAW_RETENTION_DAYS } from "./raw-retention";

beforeEach(() => {
  jest.clearAllMocks();
  polarEnabled = true;
  planRows = { plus: 7, pro: 30, unlimited: 7 };
  planLookups.length = 0;
  planLookupError = null;
  delete process.env.MONITOR_CLEANUP_ENABLED;
});

describe("getRawResultRetention", () => {
  it("reads the unlimited row when billing is off, without the plan wording", async () => {
    polarEnabled = false;
    planRows.unlimited = 14;
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days: 14, onPlan: false });
    expect(findOrg).not.toHaveBeenCalled();
    expect(planLookups).toEqual(["unlimited"]);
  });

  it("uses the shortest window when billing is off and there is no unlimited row, as cleanup does", async () => {
    polarEnabled = false;
    delete planRows.unlimited;
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days: SHORTEST_RAW_RETENTION_DAYS, onPlan: false });
  });

  it.each(["false", " NO ", "0"])("is unknown while monitor result cleanup is off (%j)", async (value) => {
    process.env.MONITOR_CLEANUP_ENABLED = value;
    findOrg.mockResolvedValue({ subscriptionPlan: "plus", subscriptionStatus: "active" });
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });

  it.each([["plus", 7], ["pro", 30]])("uses the %s row", async (plan, days) => {
    findOrg.mockResolvedValue({ subscriptionPlan: plan, subscriptionStatus: "active" });
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days, onPlan: true });
    expect(planLookups).toEqual([plan]);
  });

  it.each([
    ["a free trial", { subscriptionPlan: null, subscriptionStatus: null }],
    ["an ended trial or no plan", { subscriptionPlan: null, subscriptionStatus: null }],
    ["a canceled subscription", { subscriptionPlan: null, subscriptionStatus: "canceled" }],
    ["status none", { subscriptionPlan: null, subscriptionStatus: "none" }],
  ])("gives %s the shortest raw window, without the plan wording", async (_label, org) => {
    findOrg.mockResolvedValue(org);
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days: SHORTEST_RAW_RETENTION_DAYS, onPlan: false });
    expect(planLookups).toEqual([]);
  });

  it.each([
    ["a plan without a plan_limits row", { subscriptionPlan: "unlimited", subscriptionStatus: "active" }],
    ["an active subscription whose plan is not set yet", { subscriptionPlan: null, subscriptionStatus: "active" }],
    ["a past_due subscription whose plan is not set yet", { subscriptionPlan: null, subscriptionStatus: "past_due" }],
  ])("is unknown for %s, which cleanup skips", async (_label, org) => {
    delete planRows.unlimited;
    findOrg.mockResolvedValue(org);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });

  it("is unknown for a missing organization, a zero window or a failed lookup", async () => {
    findOrg.mockResolvedValueOnce(undefined);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    findOrg.mockResolvedValue({ subscriptionPlan: "plus", subscriptionStatus: "active" });
    planRows.plus = 0;
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    planLookupError = new Error("db down");
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    polarEnabled = false;
    planLookupError = null;
    planRows.unlimited = 0;
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });
});

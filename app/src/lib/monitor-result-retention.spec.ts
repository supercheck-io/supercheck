/** @jest-environment node */

const findOrg = jest.fn();
const getPlanLimits = jest.fn();
const getActiveTrial = jest.fn();
let polarEnabled = true;

const unlimitedRows = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: { organization: { findFirst: (...args: unknown[]) => findOrg(...args) } },
    select: () => ({ from: () => ({ where: () => ({ limit: () => unlimitedRows() }) }) }),
  },
}));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => polarEnabled }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { getPlanLimits: (plan: string) => getPlanLimits(plan) },
}));
jest.mock("@/lib/execution/trial-limits", () => ({
  getActiveTrial: (id: string) => getActiveTrial(id),
  TRIAL_RETENTION: { dataRetentionDays: 7 },
}));

import { getRawResultRetention } from "./monitor-result-retention";

const planDays: Record<string, number> = { plus: 7, pro: 30 };

beforeEach(() => {
  jest.clearAllMocks();
  polarEnabled = true;
  getPlanLimits.mockImplementation(async (plan: string) => ({ dataRetentionDays: planDays[plan] }));
  getActiveTrial.mockResolvedValue(undefined);
  unlimitedRows.mockResolvedValue([{ days: 7 }]);
  delete process.env.MONITOR_CLEANUP_ENABLED;
});

describe("getRawResultRetention", () => {
  it("reads the unlimited row when billing is off, without the plan wording", async () => {
    polarEnabled = false;
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days: 7, onPlan: false });
    expect(findOrg).not.toHaveBeenCalled();
  });

  it("is unknown when billing is off and there is no unlimited row", async () => {
    polarEnabled = false;
    unlimitedRows.mockResolvedValue([]);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });

  it.each(["false", " NO ", "0"])("is unknown while monitor result cleanup is off (%j)", async (value) => {
    process.env.MONITOR_CLEANUP_ENABLED = value;
    findOrg.mockResolvedValue({ subscriptionPlan: "plus", subscriptionStatus: "active" });
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });

  it.each([["plus", 7], ["pro", 30]])("uses the %s row", async (plan, days) => {
    findOrg.mockResolvedValue({ subscriptionPlan: plan, subscriptionStatus: "active" });
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days, onPlan: true });
  });

  it("gives a free trial the trial window", async () => {
    findOrg.mockResolvedValue({ subscriptionPlan: null, subscriptionStatus: null });
    getActiveTrial.mockResolvedValue({ expiresAt: new Date(Date.now() + 86_400_000) });
    await expect(getRawResultRetention("org-1")).resolves.toEqual({ days: 7, onPlan: false });
  });

  it.each([
    ["no plan and no trial", { subscriptionPlan: null, subscriptionStatus: null }, undefined],
    ["a trial with billing history", { subscriptionPlan: null, subscriptionStatus: "canceled" }, { expiresAt: new Date() }],
    ["an unknown plan", { subscriptionPlan: "unlimited", subscriptionStatus: "active" }, undefined],
  ])("is unknown for %s", async (_label, org, trial) => {
    findOrg.mockResolvedValue(org);
    getActiveTrial.mockResolvedValue(trial);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });

  it("is unknown for a missing organization, a zero window or a failed lookup", async () => {
    findOrg.mockResolvedValueOnce(undefined);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    findOrg.mockResolvedValue({ subscriptionPlan: "plus", subscriptionStatus: "active" });
    getPlanLimits.mockResolvedValueOnce({ dataRetentionDays: 0 });
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    getPlanLimits.mockRejectedValueOnce(new Error("db down"));
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();

    polarEnabled = false;
    unlimitedRows.mockResolvedValueOnce([{ days: 0 }]);
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
    unlimitedRows.mockRejectedValueOnce(new Error("db down"));
    await expect(getRawResultRetention("org-1")).resolves.toBeUndefined();
  });
});

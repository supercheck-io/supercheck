/** @jest-environment node */
import {
  TRIAL_DURATION_DAYS,
  TRIAL_LIMITS,
  getActiveTrial,
  isTrialActive,
  trialCheckIntervalViolation,
  trialPlanLimits,
} from "./trial-limits";

jest.mock("@/utils/db", () => ({
  db: { query: { executionEntitlements: { findFirst: jest.fn() } } },
}));

const entitlement = (expiresAt: Date) => ({
  organizationId: "org",
  expiresAt,
  ...TRIAL_LIMITS,
  playwrightUsedMs: 0,
  lifecycleEndedAt: null,
});

describe("trial limits", () => {
  it("defines a 14 day trial with abuse-bounded limits", () => {
    expect(TRIAL_DURATION_DAYS).toBe(14);
    expect(TRIAL_LIMITS).toMatchObject({
      runningCapacity: 1,
      queuedCapacity: 5,
      k6MaxVus: 5,
      maxMonitors: 5,
      maxStatusPages: 2,
      maxTeamMembers: 3,
    });
    expect(TRIAL_LIMITS.playwrightBudgetMs).toBe(30 * 60 * 1000);
  });

  it.each([
    [new Date(Date.now() + 1000), true],
    [new Date(Date.now() - 1000), false],
    [new Date("invalid"), false],
  ])("recognizes expiry %s as active=%s", (expiresAt, active) => {
    expect(isTrialActive(entitlement(expiresAt))).toBe(active);
  });

  it("is not active without an entitlement", () => {
    expect(isTrialActive(undefined)).toBe(false);
    expect(isTrialActive(null)).toBe(false);
  });

  it("maps an entitlement to a never-billed plan view", () => {
    const plan = trialPlanLimits(entitlement(new Date(Date.now() + 1000)));
    expect(plan).toMatchObject({
      playwrightMinutesIncluded: 30,
      k6VuMinutesIncluded: 0,
      maxOrganizations: 1,
      customDomains: false,
      ssoEnabled: false,
      sreInvestigationUnitsIncluded: "5",
    });
  });

  describe("lookups", () => {
    const findFirst = jest.fn();
    const database = {
      query: { executionEntitlements: { findFirst } },
    } as never;
    beforeEach(() => findFirst.mockReset());

    it("returns an unexpired entitlement and ignores an expired or missing one", async () => {
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() + 1000)));
      await expect(getActiveTrial("org", database)).resolves.toMatchObject({
        organizationId: "org",
      });
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() - 1000)));
      await expect(getActiveTrial("org", database)).resolves.toBeUndefined();
      findFirst.mockResolvedValue(undefined);
      await expect(getActiveTrial("org", database)).resolves.toBeUndefined();
    });

    it("rejects a check interval shorter than the trial minimum", async () => {
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() + 1000)));
      await expect(
        trialCheckIntervalViolation("org", 1, database),
      ).resolves.toEqual({ minimumMinutes: 5 });
      await expect(
        trialCheckIntervalViolation("org", "4", database),
      ).resolves.toEqual({ minimumMinutes: 5 });
    });

    it("allows the minimum interval and anything longer", async () => {
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() + 1000)));
      await expect(
        trialCheckIntervalViolation("org", 5, database),
      ).resolves.toBeNull();
      await expect(
        trialCheckIntervalViolation("org", 60, database),
      ).resolves.toBeNull();
    });

    it("does not restrict organizations without an active trial", async () => {
      findFirst.mockResolvedValue(undefined);
      await expect(
        trialCheckIntervalViolation("org", 1, database),
      ).resolves.toBeNull();
      await expect(
        trialCheckIntervalViolation(null, 1, database),
      ).resolves.toBeNull();
    });
  });
});

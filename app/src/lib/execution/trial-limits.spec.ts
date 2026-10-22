/** @jest-environment node */
import {
  TRIAL_DURATION_DAYS,
  TRIAL_LIMITS,
  getActiveTrial,
  buildTrialEntitlement,
  getTrialSummary,
  isTrialActive,
  isTrialEnabled,
  summarizeTrial,
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

  describe("summary for display", () => {
    const now = new Date("2026-11-01T12:00:00Z").getTime();

    it("rounds the remaining time up to whole days", () => {
      expect(
        summarizeTrial({ expiresAt: new Date(now + 13 * 86_400_000 + 1) }, now),
      ).toMatchObject({ active: true, daysRemaining: 14 });
      expect(
        summarizeTrial({ expiresAt: new Date(now + 3_600_000) }, now),
      ).toMatchObject({ active: true, daysRemaining: 1 });
    });

    it("reports an ended trial as inactive with no days left", () => {
      expect(summarizeTrial({ expiresAt: new Date(now - 1) }, now)).toEqual({
        active: false,
        expiresAt: new Date(now - 1).toISOString(),
        daysRemaining: 0,
      });
    });

    it("looks up the summary, including a trial that has already ended, and nothing for others", async () => {
      const findFirst = jest.fn();
      const database = {
        query: { executionEntitlements: { findFirst } },
      } as never;
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() - 1000)));
      await expect(getTrialSummary("org", database)).resolves.toMatchObject({
        active: false,
        daysRemaining: 0,
      });
      findFirst.mockResolvedValue(undefined);
      await expect(getTrialSummary("org", database)).resolves.toBeUndefined();
    });
  });

  describe("launch switch and provisioning", () => {
    it.each([
      ["true", true],
      ["1", true],
      [" TRUE ", true],
      ["false", false],
      ["", false],
      [undefined, false],
    ])("reads TRIAL_ENABLED=%j as %s", (value, enabled) => {
      expect(
        isTrialEnabled({
          TRIAL_ENABLED: value,
        } as unknown as NodeJS.ProcessEnv),
      ).toBe(enabled);
    });

    it("builds a 14 day entitlement with the trial limits", () => {
      const now = new Date("2026-11-01T00:00:00Z");
      expect(buildTrialEntitlement("org", now)).toEqual({
        organizationId: "org",
        expiresAt: new Date("2026-11-15T00:00:00Z"),
        ...TRIAL_LIMITS,
      });
    });
  });
});

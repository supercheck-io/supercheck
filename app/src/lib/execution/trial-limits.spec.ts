/** @jest-environment node */
import {
  TRIAL_DURATION_DAYS,
  TRIAL_LIMITS,
  getActiveTrial,
  buildTrialEntitlement,
  countTrialInvestigations,
  getTrialUsage,
  getTrialSummary,
  isTrialActive,
  isTrialEnabled,
  summarizeTrial,
  trialCheckIntervalViolation,
  trialPlanLimits,
} from "./trial-limits";

import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

jest.mock("@/utils/db", () => ({
  db: { query: { executionEntitlements: { findFirst: jest.fn() } } },
}));

const entitlement = (expiresAt: Date) => ({
  organizationId: "org",
  expiresAt,
  ...TRIAL_LIMITS,
  playwrightUsedMs: 0,
  k6BudgetVuMs: 9_000_000,
  k6UsedVuMs: 0,
  trialStartedAt: new Date(0),
  lifecycleEndedAt: null,
  midwayNotifiedAt: null,
  endingNotifiedAt: null,
  endedNotifiedAt: null,
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
    const orgRows = jest.fn();
    const database = {
      query: { executionEntitlements: { findFirst } },
      select: () => ({ from: () => ({ where: () => ({ limit: orgRows }) }) }),
    } as never;
    beforeEach(() => {
      findFirst.mockReset();
      orgRows.mockReset().mockResolvedValue([]);
    });

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

    it("lets an organization that has subscribed keep one-minute checks while its trial row lingers", async () => {
      findFirst.mockResolvedValue(entitlement(new Date(Date.now() + 1000)));
      orgRows.mockResolvedValue([{ polarCustomerId: "cus", subscriptionPlan: "plus", subscriptionStatus: "active", subscriptionEndsAt: null }]);
      await expect(trialCheckIntervalViolation("org", 1, database)).resolves.toBeNull();
      orgRows.mockResolvedValue([{ polarCustomerId: null, subscriptionPlan: null, subscriptionStatus: "none", subscriptionEndsAt: null }]);
      await expect(trialCheckIntervalViolation("org", 1, database)).resolves.toEqual({ minimumMinutes: 5 });
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
        trialStartedAt: now,
        expiresAt: new Date("2026-11-15T00:00:00Z"),
        ...TRIAL_LIMITS,
      });
    });
  });

  describe("consistency with the database defaults", () => {
    // Column defaults live in 0037 and in the later migration that added the load-test allowance.
    const migration = ["0037_execution_entitlements.sql", "0038_trial_load_test_budget.sql"]
      .map((file) => readFileSync(resolve(__dirname, "../../db/migrations", file), "utf8"))
      .join("\n");
    const defaultOf = (column: string) => {
      const match = migration.match(
        new RegExp(`"${column}" (?:integer|bigint) NOT NULL DEFAULT (\\d+)`),
      );
      expect(match).not.toBeNull();
      return Number(match![1]);
    };

    it.each([
      ["running_capacity", TRIAL_LIMITS.runningCapacity],
      ["queued_capacity", TRIAL_LIMITS.queuedCapacity],
      ["k6_max_vus", TRIAL_LIMITS.k6MaxVus],
      ["playwright_budget_ms", TRIAL_LIMITS.playwrightBudgetMs],
      ["k6_budget_vu_ms", TRIAL_LIMITS.k6BudgetVuMs],
      ["max_monitors", TRIAL_LIMITS.maxMonitors],
      ["min_check_interval_minutes", TRIAL_LIMITS.minCheckIntervalMinutes],
      ["max_status_pages", TRIAL_LIMITS.maxStatusPages],
      ["max_status_page_subscribers", TRIAL_LIMITS.maxStatusPageSubscribers],
      ["max_team_members", TRIAL_LIMITS.maxTeamMembers],
      ["max_projects", TRIAL_LIMITS.maxProjects],
      ["sre_investigation_units", TRIAL_LIMITS.sreInvestigationUnits],
      ["ai_credits", TRIAL_LIMITS.aiCredits],
    ])(
      "keeps the %s default equal to the shared catalog (%s)",
      (column, expected) => {
        expect(defaultOf(column)).toBe(expected);
      },
    );
  });

  describe("usage", () => {
    const selectCount = (count: number) => {
      const where = jest.fn().mockResolvedValue([{ count }]);
      return {
        select: jest.fn(() => ({ from: jest.fn(() => ({ where })) })),
        where,
      } as never;
    };

    it("counts investigations started since the trial began", async () => {
      await expect(
        countTrialInvestigations(
          "org",
          new Date(Date.now() + 86_400_000),
          selectCount(4),
        ),
      ).resolves.toBe(4);
    });

    it("counts only running and completed investigations", async () => {
      const database = selectCount(1) as unknown as { where: jest.Mock };
      await countTrialInvestigations("org", new Date(Date.now() + 86_400_000), database as never);
      const { sql: text, params } = new PgDialect().sqlToQuery(database.where.mock.calls[0][0]);
      expect(text).toContain('"status"');
      expect(params).toEqual(expect.arrayContaining(["running", "completed"]));
      expect(params).not.toContain("failed");
    });

    it("counts none when there is no row", async () => {
      const database = {
        select: jest.fn(() => ({
          from: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })),
        })),
      } as never;
      await expect(
        countTrialInvestigations("org", new Date(), database),
      ).resolves.toBe(0);
    });

    it("reports browser time in minutes and the investigations started", async () => {
      await expect(
        getTrialUsage(
          "org",
          {
            expiresAt: new Date(Date.now() + 86_400_000),
            playwrightUsedMs: 5 * 60_000 + 30_000,
          },
          selectCount(2),
        ),
      ).resolves.toEqual({
        playwrightMinutesUsed: 5.5,
        sreInvestigationsUsed: 2,
      });
    });
  });
});

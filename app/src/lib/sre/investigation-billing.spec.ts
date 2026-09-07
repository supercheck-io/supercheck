/** @jest-environment node */

import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(),
}));

jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    hasActiveSubscription: jest.fn(),
    getOrganizationPlanSafe: jest.fn(),
  },
}));

jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: {
    shouldBlockUsage: jest.fn(),
    getSpendingStatus: jest.fn(),
  },
}));

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
    query: {
      organization: { findFirst: jest.fn() },
    },
  },
}));

import { isPolarEnabled } from "@/lib/feature-flags";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";

import {
  assertCanStartSreInvestigation,
  consumeSreInvestigationCredit,
  failStuckSreInvestigationRuns,
  getSreInvestigationUsage,
  reconcileUnbilledSreInvestigations,
  SreInvestigationBillingError,
  withSreInvestigationAdmission,
} from "./investigation-billing";

const mockIsPolarEnabled = isPolarEnabled as jest.Mock;
const mockSubscriptionService = subscriptionService as jest.Mocked<typeof subscriptionService>;
const mockPolarUsageService = polarUsageService as jest.Mocked<typeof polarUsageService>;
const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  transaction: jest.Mock;
  query: { organization: { findFirst: jest.Mock } };
};

function lockedOrganizationSelect() {
  return { from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ for: jest.fn().mockResolvedValue([{ id: "org-1" }]) }) }) };
}

const planFixture = {
  id: "plan-1",
  plan: "plus" as const,
  maxMonitors: 10,
  minCheckIntervalMinutes: 5,
  playwrightMinutesIncluded: 100,
  k6VuMinutesIncluded: 100,
  aiCreditsIncluded: 10,
  sreInvestigationUnitsIncluded: "10.0000",
  runningCapacity: 1,
  queuedCapacity: 10,
  maxTeamMembers: 3,
  maxOrganizations: 1,
  maxProjects: 3,
  maxStatusPages: 1,
  maxStatusPageSubscribers: 500,
  customDomains: false,
  ssoEnabled: false,
  dataRetentionDays: 30,
  aggregatedDataRetentionDays: 30,
  jobDataRetentionDays: 30,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("SRE investigation billing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPolarEnabled.mockReturnValue(true);
    mockSubscriptionService.hasActiveSubscription.mockResolvedValue(true);
    mockSubscriptionService.getOrganizationPlanSafe.mockResolvedValue(planFixture);
    mockPolarUsageService.shouldBlockUsage.mockResolvedValue({ blocked: false });
  });

  it("marks investigations beyond the recovery window as failed", async () => {
    const returning = jest.fn().mockResolvedValue([{ id: "stuck-run" }]);
    const where = jest.fn(() => ({ returning }));
    const set: jest.Mock = jest.fn(() => ({ where }));
    mockDb.update.mockReturnValue({ set });

    await expect(
      failStuckSreInvestigationRuns({ olderThanMinutes: 15 }),
    ).resolves.toEqual({ failed: 1 });

    const payload = set.mock.calls[0]?.[0] as {
      status: string;
      completedAt: unknown;
      durationMs: unknown;
      agentStateSnapshot: { mode?: string };
    };
    expect(payload.status).toBe("failed");
    expect(payload.completedAt).not.toBeInstanceOf(Date);
    expect(payload.agentStateSnapshot).toEqual(
      expect.objectContaining({
        mode: "sre_investigation_recovery",
      }),
    );

    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(sql`${payload.completedAt}`).sql).toContain("now()");
    expect(dialect.sqlToQuery(sql`${payload.durationMs}`).sql).toContain(
      "now() - \"sre_investigation_runs\".\"started_at\"",
    );
  });

  it.each([
    { projected: 100, hardStop: true, allowed: true },
    { projected: 101, hardStop: true, allowed: false },
    { projected: 101, hardStop: false, allowed: true },
  ])("checks reservations plus the new run before admission ($projected/$hardStop)", async ({ projected, hardStop, allowed }) => {
    const locked = jest.fn().mockResolvedValue([{ id: "org-1", subscriptionPlan: "plus", subscriptionStatus: "active" }]);
    const pendingWhere = jest.fn().mockResolvedValue([{ count: 2 }]);
    const tx = {
      insert: jest.fn(),
      select: jest.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ for: locked }) }) })
        .mockReturnValueOnce({ from: () => ({ leftJoin: () => ({ where: pendingWhere }) }) }),
    };
    mockDb.transaction.mockImplementation(async (callback) => callback(tx));
    mockPolarUsageService.getSpendingStatus.mockResolvedValue({
      currentSpendingCents: projected, limitCents: 100, limitEnabled: true,
      hardStopEnabled: hardStop, isAtLimit: projected >= 100, percentageUsed: projected, remainingCents: 0,
    });
    const create = jest.fn().mockResolvedValue("run-1");
    const admission = withSreInvestigationAdmission("org-1", create);
    if (allowed) await expect(admission).resolves.toBe("run-1");
    else await expect(admission).rejects.toMatchObject({ code: "spending_limit" });
    expect(locked).toHaveBeenCalledWith("update");
    expect(mockPolarUsageService.getSpendingStatus).toHaveBeenCalledWith("org-1", { database: tx, additionalSreUnits: 3 });
    expect(create).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it("does not reserve or check billing for self-hosted admission", async () => {
    mockIsPolarEnabled.mockReturnValue(false);
    const create = jest.fn().mockResolvedValue("run-1");
    await expect(withSreInvestigationAdmission("org-1", create)).resolves.toBe("run-1");
    expect(create).toHaveBeenCalledWith(db);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("admits only one of two competing runs when one charge remains (transaction simulation)", async () => {
    let reservations = 0;
    let tail = Promise.resolve();
    mockDb.transaction.mockImplementation(async (callback) => {
      let release: (() => void) | undefined;
      const tx = { insert: jest.fn(), select: jest.fn((fields) => fields
        ? { from: () => ({ leftJoin: () => ({ where: async () => [{ count: reservations }] }) }) }
        : { from: () => ({ where: () => ({ for: async () => {
          const previous = tail;
          tail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          return [{ id: "org-1", subscriptionPlan: "plus", subscriptionStatus: "active" }];
        } }) }) }) };
      try { return await callback(tx); } finally { release?.(); }
    });
    mockPolarUsageService.getSpendingStatus.mockImplementation(async (_org, projection) => ({
      currentSpendingCents: (projection?.additionalSreUnits ?? 0) * 50,
      limitCents: 50, limitEnabled: true, hardStopEnabled: true,
      isAtLimit: false, percentageUsed: 0, remainingCents: 50,
    }));
    const create = jest.fn(async () => { reservations += 1; return "run-1"; });
    const outcomes = await Promise.allSettled([
      withSreInvestigationAdmission("org-1", create),
      withSreInvestigationAdmission("org-1", create),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("skips billing in self-hosted mode", async () => {
    mockIsPolarEnabled.mockReturnValue(false);

    await expect(assertCanStartSreInvestigation("org-1")).resolves.toEqual({ billable: false });
    await expect(consumeSreInvestigationCredit({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      incidentId: "incident-1",
      investigationRunId: "run-1",
      useLiveConnectors: false,
    })).resolves.toEqual({ billed: false });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("blocks when subscription is inactive", async () => {
    mockSubscriptionService.hasActiveSubscription.mockResolvedValue(false);

    await expect(assertCanStartSreInvestigation("org-1")).rejects.toMatchObject({
      code: "subscription_required",
    } satisfies Partial<SreInvestigationBillingError>);
  });

  it("blocks when the organization hard spending limit is reached", async () => {
    mockPolarUsageService.shouldBlockUsage.mockResolvedValue({
      blocked: true,
      reason: "Monthly spending limit reached",
    });

    await expect(assertCanStartSreInvestigation("org-1")).rejects.toMatchObject({
      message: "Monthly spending limit reached",
      code: "spending_limit",
    } satisfies Partial<SreInvestigationBillingError>);

    expect(mockSubscriptionService.hasActiveSubscription).toHaveBeenCalledWith(
      "org-1",
    );
    expect(mockPolarUsageService.shouldBlockUsage).toHaveBeenCalledWith("org-1");
  });

  it("records usage event and increments organization counter", async () => {
    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const insertReturning = jest.fn().mockResolvedValue([{ id: "event-1" }]);
    const insertValues = jest.fn(() => ({ returning: insertReturning }));
    const tx = {
      select: jest.fn(lockedOrganizationSelect),
      execute: jest.fn().mockResolvedValue([]),
      query: {
        organization: {
          findFirst: jest.fn().mockResolvedValue({
            id: "org-1",
            usagePeriodStart: new Date("2026-06-01T00:00:00Z"),
            usagePeriodEnd: new Date("2026-07-01T00:00:00Z"),
          }),
        },
        usageEvents: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
      update: jest.fn(() => ({ set: updateSet })),
      insert: jest.fn(() => ({ values: insertValues })),
    };
    mockDb.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(consumeSreInvestigationCredit({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      incidentId: "incident-1",
      investigationRunId: "run-1",
      useLiveConnectors: true,
    })).resolves.toEqual({ billed: true, usageEventId: "event-1", duplicate: false });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ sreInvestigationUnitsUsed: expect.anything() }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "sre_investigation",
      eventName: "sre_investigations",
      units: "1.0000",
      unitType: "investigation_units",
      metadata: expect.objectContaining({ investigationRunId: "run-1", useLiveConnectors: true }),
    }));
  });

  it("does not charge the same investigation run twice", async () => {
    const tx = {
      execute: jest.fn().mockResolvedValue([]),
      query: {
        usageEvents: {
          findFirst: jest.fn().mockResolvedValue({ id: "event-existing" }),
        },
        organization: { findFirst: jest.fn() },
      },
      update: jest.fn(),
      insert: jest.fn(),
    };
    mockDb.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
    );

    await expect(
      consumeSreInvestigationCredit({
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
        incidentId: "incident-1",
        investigationRunId: "run-1",
        useLiveConnectors: false,
      })
    ).resolves.toEqual({
      billed: true,
      usageEventId: "event-existing",
      duplicate: true,
    });

    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("returns current usage against plan allowance", async () => {
    mockDb.query.organization.findFirst.mockResolvedValue({ sreInvestigationUnitsUsed: "12.0000" });

    await expect(getSreInvestigationUsage("org-1")).resolves.toEqual({
      used: 12,
      included: 10,
      overage: 2,
    });
  });

  it("reconciles only full investigations and preserves live-connector metadata", async () => {
    const candidateQuery = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          id: "run-investigation",
          organizationId: "org-1",
          projectId: "project-1",
          incidentId: "incident-1",
          userId: "user-1",
          agentType: "investigation",
          promptInput: { liveConnectorsEnabled: true },
        },
        {
          id: "run-triage",
          organizationId: "org-1",
          projectId: "project-1",
          incidentId: "incident-1",
          userId: "user-1",
          agentType: "triage",
          promptInput: { mode: "sre_triage_api" },
        },
      ]),
    };
    mockDb.select.mockReturnValue(candidateQuery);

    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const insertReturning = jest.fn().mockResolvedValue([{ id: "event-1" }]);
    const insertValues = jest.fn(() => ({ returning: insertReturning }));
    const tx = {
      execute: jest.fn().mockResolvedValue([]),
      query: {
        organization: {
          findFirst: jest.fn().mockResolvedValue({
            id: "org-1",
            usagePeriodStart: new Date("2026-06-01T00:00:00Z"),
            usagePeriodEnd: new Date("2026-07-01T00:00:00Z"),
          }),
        },
        usageEvents: { findFirst: jest.fn().mockResolvedValue(null) },
      },
      select: jest.fn(lockedOrganizationSelect),
      update: jest.fn(() => ({ set: updateSet })),
      insert: jest.fn(() => ({ values: insertValues })),
    };
    mockDb.transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(reconcileUnbilledSreInvestigations()).resolves.toEqual({
      processed: 1,
      failed: 0,
    });

    const joinPredicate = candidateQuery.leftJoin.mock.calls[0]?.[1];
    const compiledJoinPredicate = new PgDialect().sqlToQuery(sql`${joinPredicate}`).sql;
    expect(compiledJoinPredicate).toContain(
      `->>'investigationRunId' = CAST("sre_investigation_runs"."id" AS text)`,
    );

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          investigationRunId: "run-investigation",
          useLiveConnectors: true,
        }),
      }),
    );
  });
});

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
    const set = jest.fn(() => ({ where }));
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

  it("records usage event and increments organization counter", async () => {
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

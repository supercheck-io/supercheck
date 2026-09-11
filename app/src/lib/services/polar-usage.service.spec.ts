/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      usageEvents: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      organization: { findFirst: jest.fn() },
    },
    selectDistinct: jest.fn(),
    update: jest.fn(),
  },
  postgresClient: { reserve: jest.fn() },
}));

jest.mock("@/db/schema", () => ({
  organization: { id: "organization.id" },
  usageEvents: {
    id: "usageEvents.id",
    organizationId: "usageEvents.organizationId",
    syncedToPolar: "usageEvents.syncedToPolar",
    syncAttempts: "usageEvents.syncAttempts",
    lastSyncAttempt: "usageEvents.lastSyncAttempt",
    createdAt: "usageEvents.createdAt",
  },
  billingSettings: { organizationId: "billingSettings.organizationId" },
  overagePricing: { plan: "overagePricing.plan" },
  planLimits: { plan: "planLimits.plan" },
}));

jest.mock("drizzle-orm", () => ({
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
  and: jest.fn((...conditions) => ({ op: "and", conditions })),
  sql: jest.fn(() => ({ op: "sql" })),
  gt: jest.fn((left, right) => ({ op: "gt", left, right })),
  lte: jest.fn((left, right) => ({ op: "lte", left, right })),
}));

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
  getPolarConfig: jest.fn(() => ({
    accessToken: "sandbox-token",
    server: "sandbox",
    webhookSecret: "sandbox-webhook-secret",
  })),
}));

jest.mock("@/lib/logger/index", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@polar-sh/sdk", () => ({
  Polar: jest.fn(() => ({})),
}));
jest.mock("./subscription-service", () => ({ subscriptionService: { getOrganizationPlanSafe: jest.fn() } }));

jest.mock("@/lib/sre/investigation-billing", () => ({
  failStuckSreInvestigationRuns: jest.fn().mockResolvedValue({ failed: 0 }),
  reconcileUnbilledSreInvestigations: jest
    .fn()
    .mockResolvedValue({ processed: 0, failed: 0 }),
}));

import { db, postgresClient } from "@/utils/db";

import { polarUsageService } from "./polar-usage.service";

const mockDb = db as unknown as {
  query: {
    usageEvents: { findFirst: jest.Mock; findMany: jest.Mock };
    organization: { findFirst: jest.Mock };
  };
  selectDistinct: jest.Mock;
  update: jest.Mock;
};
const mockPostgresClient = postgresClient as unknown as {
  reserve: jest.Mock;
};

describe("PolarUsageService retry idempotency", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("projects reserved units using the transaction's allowance and configured prices", async () => {
    const database = { query: {
      organization: { findFirst: jest.fn().mockResolvedValue({ subscriptionPlan: "plus", sreInvestigationUnitsUsed: "9", playwrightMinutesUsed: 105 }) },
      planLimits: { findFirst: jest.fn().mockResolvedValue({ playwrightMinutesIncluded: 100, k6VuMinutesIncluded: 100, aiCreditsIncluded: 10, sreInvestigationUnitsIncluded: "10" }) },
      overagePricing: { findFirst: jest.fn().mockResolvedValue({ playwrightMinutePriceCents: 2, sreInvestigationUnitPriceCents: 75 }) },
      billingSettings: { findFirst: jest.fn().mockResolvedValue({ enableSpendingLimit: true, hardStopOnLimit: true, monthlySpendingLimitCents: 84 }) },
    } } as unknown as Pick<typeof db, "query">;
    const metrics = await polarUsageService.getUsageMetrics("org-1", { database, additionalSreUnits: 2 });
    expect(metrics.sreInvestigations).toMatchObject({ used: 11, included: 10, overageCostCents: 75 });
    expect(metrics.totalOverageCostCents).toBe(85);
    const spending = await polarUsageService.getSpendingStatus("org-1", { database, additionalSreUnits: 2 });
    expect(spending).toMatchObject({ currentSpendingCents: 85, isAtLimit: true });
    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["plus", 25, 25, 0], ["plus", 25, 26, 50],
    ["pro", 100, 100, 0], ["pro", 100, 101, 50],
  ])("prices %s allowance %i at usage %i without increasing the overage rate", async (plan, included, used, expected) => {
    const database = { query: {
      organization: { findFirst: jest.fn().mockResolvedValue({ subscriptionPlan: plan, sreInvestigationUnitsUsed: String(used), playwrightMinutesUsed: 3000.0833 }) },
      planLimits: { findFirst: jest.fn().mockResolvedValue({ playwrightMinutesIncluded: 3000, k6VuMinutesIncluded: 100, aiCreditsIncluded: 100, sreInvestigationUnitsIncluded: String(included) }) },
      overagePricing: { findFirst: jest.fn().mockResolvedValue({ playwrightMinutePriceCents: 3, sreInvestigationUnitPriceCents: 50 }) },
    } } as unknown as Pick<typeof db, "query">;
    const metrics = await polarUsageService.getUsageMetrics("org-1", { database, additionalSreUnits: 0 });
    expect(metrics.sreInvestigations.overageCostCents).toBe(expected);
    expect(metrics.playwrightMinutes.overageCostCents).toBeCloseTo(0.2499, 4);
  });

  it("reuses the usage ledger ID as external_id after a failed ingestion", async () => {
    const event = {
      id: "usage-event-1",
      organizationId: "org-1",
      eventType: "sre_investigation",
      units: "1.0000",
      unitType: "investigation_units",
      metadata: { useLiveConnectors: true },
      createdAt: new Date("2026-09-04T05:46:19.347Z"),
    };

    mockDb.query.usageEvents.findMany.mockResolvedValue([event]);
    mockDb.query.usageEvents.findFirst.mockResolvedValue(event);
    mockDb.query.organization.findFirst.mockResolvedValue({
      polarCustomerId: "polar-customer-1",
    });

    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    mockDb.update.mockReturnValue({ set: updateSet });

    const changedWhere = jest.fn().mockResolvedValue([]);
    const changedFrom = jest.fn(() => ({ where: changedWhere }));
    mockDb.selectDistinct.mockReturnValue({ from: changedFrom });

    const transaction = jest.fn().mockResolvedValue([{ locked: true }]);
    const reserved = Object.assign(jest.fn(), {
      begin: jest.fn(
        async (callback: (sql: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      release: jest.fn(),
    });
    mockPostgresClient.reserve.mockResolvedValue(reserved);

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValue("temporarily unavailable"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: jest.fn().mockResolvedValue({ inserted: 1 }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(polarUsageService.syncPendingEvents()).resolves.toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    await expect(polarUsageService.syncPendingEvents()).resolves.toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
    });

    const payloads = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(payloads).toHaveLength(2);
    expect(payloads[0].events[0]).toEqual(
      expect.objectContaining({
        name: "sre_investigations",
        external_id: event.id,
      }),
    );
    expect(payloads[1].events[0].external_id).toBe(
      payloads[0].events[0].external_id,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        "Polar-Version": "2026-04",
      }),
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        syncedToPolar: true,
        polarEventId: event.id,
        syncError: null,
      }),
    );

    const lockQueries = transaction.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray).join(""),
    );
    expect(lockQueries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pg_try_advisory_xact_lock"),
      ]),
    );
    expect(reserved.release).toHaveBeenCalledTimes(2);
  });

  it("skips safely when another scheduler owns the transaction lock", async () => {
    const transaction = jest.fn().mockResolvedValue([{ locked: false }]);
    const reserved = Object.assign(jest.fn(), {
      begin: jest.fn(
        async (callback: (sql: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      release: jest.fn(),
    });
    mockPostgresClient.reserve.mockResolvedValue(reserved);

    await expect(polarUsageService.syncPendingEvents()).resolves.toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    });

    expect(mockDb.query.usageEvents.findMany).not.toHaveBeenCalled();
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
});

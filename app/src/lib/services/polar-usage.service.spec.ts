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

  afterAll(() => {
    global.fetch = originalFetch;
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

    const reserved = Object.assign(
      jest.fn().mockResolvedValue([{ locked: true }]),
      { release: jest.fn() },
    );
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

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        syncedToPolar: true,
        polarEventId: event.id,
        syncError: null,
      }),
    );

    const lockQueries = reserved.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray).join(""),
    );
    expect(lockQueries).toEqual(
      expect.arrayContaining([expect.stringContaining("pg_advisory_unlock_all")]),
    );
  });
});

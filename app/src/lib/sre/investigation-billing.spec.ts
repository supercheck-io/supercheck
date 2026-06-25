/** @jest-environment node */

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
  getSreInvestigationUsage,
  SreInvestigationBillingError,
} from "./investigation-billing";

const mockIsPolarEnabled = isPolarEnabled as jest.Mock;
const mockSubscriptionService = subscriptionService as jest.Mocked<typeof subscriptionService>;
const mockPolarUsageService = polarUsageService as jest.Mocked<typeof polarUsageService>;
const mockDb = db as unknown as {
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
      query: {
        organization: {
          findFirst: jest.fn().mockResolvedValue({
            id: "org-1",
            usagePeriodStart: new Date("2026-06-01T00:00:00Z"),
            usagePeriodEnd: new Date("2026-07-01T00:00:00Z"),
          }),
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
    })).resolves.toEqual({ billed: true, usageEventId: "event-1" });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ sreInvestigationUnitsUsed: expect.anything() }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "sre_investigation",
      eventName: "sre_investigations",
      units: "1.0000",
      unitType: "investigation_units",
      metadata: expect.objectContaining({ investigationRunId: "run-1", useLiveConnectors: true }),
    }));
  });

  it("returns current usage against plan allowance", async () => {
    mockDb.query.organization.findFirst.mockResolvedValue({ sreInvestigationUnitsUsed: "12.0000" });

    await expect(getSreInvestigationUsage("org-1")).resolves.toEqual({
      used: 12,
      included: 10,
      overage: 2,
    });
  });
});

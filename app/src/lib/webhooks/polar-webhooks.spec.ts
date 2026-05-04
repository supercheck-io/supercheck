jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    updateSubscription: jest.fn(),
    resetUsageCountersWithDates: jest.fn(),
    updateUsagePeriod: jest.fn(),
  },
}));

jest.mock("@/lib/services/billing-settings.service", () => ({
  billingSettingsService: {
    resetNotificationsForPeriod: jest.fn(),
  },
}));

jest.mock("@/utils/db", () => ({
  db: {
    insert: jest.fn(),
    update: jest.fn(),
    query: {
      organization: {
        findFirst: jest.fn(),
      },
      webhookIdempotency: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/db/schema", () => ({
  organization: {
    id: "organization.id",
    subscriptionId: "organization.subscriptionId",
    polarCustomerId: "organization.polarCustomerId",
  },
  webhookIdempotency: {
    webhookId: "webhookIdempotency.webhookId",
    eventType: "webhookIdempotency.eventType",
  },
}));

jest.mock("drizzle-orm", () => ({
  and: jest.fn((...conditions) => ({ op: "and", conditions })),
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
  isNull: jest.fn((value) => ({ op: "isNull", value })),
  lt: jest.fn((left, right) => ({ op: "lt", left, right })),
}));

import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";
import {
  handleCustomerDeleted,
  handleSubscriptionCreated,
  handleSubscriptionCanceled,
  handleSubscriptionUpdated,
} from "./polar-webhooks";

const mockDb = db as jest.Mocked<typeof db>;
const mockUpdateSubscription = subscriptionService.updateSubscription as jest.Mock;
const mockResetUsageCounters = subscriptionService.resetUsageCountersWithDates as jest.Mock;

function mockWebhookClaim() {
  const returning = jest.fn().mockResolvedValue([{ webhookId: "evt-1" }]);
  const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ onConflictDoNothing });
  (mockDb.insert as jest.Mock).mockReturnValue({ values });
}

function mockDbUpdate() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  (mockDb.update as jest.Mock).mockReturnValue({ set });
}

describe("polar-webhooks", () => {
  const org = {
    id: "org-123",
    subscriptionId: "sub-123",
    polarCustomerId: "cus-123",
    subscriptionPlan: "plus",
    subscriptionStatus: "active",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebhookClaim();
    mockDbUpdate();
    (mockDb.query.organization.findFirst as jest.Mock).mockResolvedValue(org);
  });

  it("uses currentPeriodEnd as canceled subscription grace end when endsAt is absent", async () => {
    await handleSubscriptionCanceled({
      id: "evt-canceled",
      type: "subscription.canceled",
      data: {
        id: "sub-123",
        currentPeriodEnd: "2026-05-24T00:00:00.000Z",
      },
    } as any);

    expect(mockUpdateSubscription).toHaveBeenCalledWith(
      "org-123",
      expect.objectContaining({
        subscriptionStatus: "canceled",
        subscriptionEndsAt: new Date("2026-05-24T00:00:00.000Z"),
      }),
    );
  });

  it("preserves explicit endsAt over currentPeriodEnd for canceled subscriptions", async () => {
    await handleSubscriptionCanceled({
      id: "evt-canceled",
      type: "subscription.canceled",
      data: {
        id: "sub-123",
        endsAt: "2026-05-20T00:00:00.000Z",
        currentPeriodEnd: "2026-05-24T00:00:00.000Z",
      },
    } as any);

    expect(mockUpdateSubscription).toHaveBeenCalledWith(
      "org-123",
      expect.objectContaining({
        subscriptionStatus: "canceled",
        subscriptionEndsAt: new Date("2026-05-20T00:00:00.000Z"),
      }),
    );
  });

  it("uses currentPeriodEnd as grace end for subscription.updated canceled payloads", async () => {
    const previousPlusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
    process.env.POLAR_PLUS_PRODUCT_ID = "prod-plus";

    try {
      await handleSubscriptionUpdated({
        id: "evt-updated",
        type: "subscription.updated",
        data: {
          id: "sub-123",
          customerId: "cus-123",
          productId: "prod-plus",
          status: "canceled",
          currentPeriodEnd: "2026-05-24T00:00:00.000Z",
        },
      } as any);

      expect(mockUpdateSubscription).toHaveBeenCalledWith(
        "org-123",
        expect.objectContaining({
          subscriptionPlan: "plus",
          subscriptionStatus: "canceled",
          subscriptionEndsAt: new Date("2026-05-24T00:00:00.000Z"),
        }),
      );
    } finally {
      process.env.POLAR_PLUS_PRODUCT_ID = previousPlusProductId;
    }
  });

  it("records subscription.created without granting access when the status is not active", async () => {
    await handleSubscriptionCreated({
      id: "evt-created",
      type: "subscription.created",
      data: {
        id: "sub-123",
        customerId: "cus-123",
        status: "incomplete",
        metadata: {
          referenceId: "org-123",
        },
      },
    } as any);

    expect(mockUpdateSubscription).toHaveBeenCalledWith(
      "org-123",
      expect.objectContaining({
        subscriptionId: "sub-123",
        polarCustomerId: "cus-123",
      })
    );
    expect(mockUpdateSubscription).not.toHaveBeenCalledWith(
      "org-123",
      expect.objectContaining({
        subscriptionPlan: expect.anything(),
        subscriptionStatus: "active",
      })
    );
    expect(mockResetUsageCounters).not.toHaveBeenCalled();
  });

  it("marks active subscription.created as errored when activation cannot find an org", async () => {
    (mockDb.query.organization.findFirst as jest.Mock).mockResolvedValue(null);

    await handleSubscriptionCreated({
      id: "evt-created-active",
      type: "subscription.created",
      data: {
        id: "sub-123",
        customerId: "cus-123",
        status: "active",
      },
    } as any);

    const updateResult = (mockDb.update as jest.Mock).mock.results.at(-1)?.value;
    expect(updateResult.set).toHaveBeenCalledWith(
      expect.objectContaining({
        resultStatus: "error",
        resultMessage: "Activation failed from already-active payload",
      }),
    );
    expect(mockUpdateSubscription).not.toHaveBeenCalled();
  });

  it("prefers organization referenceId over customer lookup for subscription.updated", async () => {
    const previousPlusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
    process.env.POLAR_PLUS_PRODUCT_ID = "prod-plus";

    try {
      (mockDb.query.organization.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(org);

      await handleSubscriptionUpdated({
        id: "evt-updated",
        type: "subscription.updated",
        data: {
          id: "sub-123",
          customerId: "cus-shared",
          productId: "prod-plus",
          status: "active",
          metadata: {
            referenceId: "org-123",
          },
        },
      } as any);

      expect(mockDb.query.organization.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            left: "organization.id",
            right: "org-123",
          }),
        }),
      );
    } finally {
      process.env.POLAR_PLUS_PRODUCT_ID = previousPlusProductId;
    }
  });

  it("revokes every org linked to a deleted customer", async () => {
    await handleCustomerDeleted({
      id: "evt-customer-deleted",
      type: "customer.deleted",
      data: {
        id: "cus-123",
      },
    } as any);

    const lastUpdate = (mockDb.update as jest.Mock).mock.results.at(-1)?.value;
    const setResult = lastUpdate?.set?.mock?.results?.[0]?.value;

    expect(setResult.where).toHaveBeenCalledWith(
      expect.objectContaining({
        left: "organization.polarCustomerId",
        right: "cus-123",
      })
    );
  });
});

jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    updateSubscription: jest.fn(),
    resetUsageCountersWithDates: jest.fn(),
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
    delete: jest.fn(),
    query: {
      webhookIdempotency: { findFirst: jest.fn() },
      organization: { findFirst: jest.fn() },
    },
  },
}));

jest.mock("@/db/schema", () => ({
  organization: {
    id: "organization.id",
    polarCustomerId: "organization.polarCustomerId",
    subscriptionId: "organization.subscriptionId",
  },
  webhookIdempotency: {
    webhookId: "webhookIdempotency.webhookId",
    eventType: "webhookIdempotency.eventType",
    expiresAt: "webhookIdempotency.expiresAt",
  },
}));

jest.mock("drizzle-orm", () => ({
  and: jest.fn((...args) => ({ op: "and", args })),
  eq: jest.fn((left, right) => ({ op: "eq", left, right })),
  isNull: jest.fn((value) => ({ op: "isNull", value })),
  lt: jest.fn((left, right) => ({ op: "lt", left, right })),
}));

import { db } from "@/utils/db";
import { subscriptionService } from "@/lib/services/subscription-service";
import {
  getSubscriptionDatesFromPayload,
  handleSubscriptionActive,
  handleSubscriptionCreated,
  handleSubscriptionPastDue,
  handleSubscriptionUpdated,
} from "./polar-webhooks";

describe("Polar webhook helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POLAR_PLUS_PRODUCT_ID = "prod_plus";
    process.env.POLAR_PRO_PRODUCT_ID = "prod_pro";
  });

  function mockWebhookClaim() {
    const returning = jest.fn().mockResolvedValue([{ id: "claim_1" }]);
    const onConflictDoNothing = jest.fn().mockReturnValue({ returning });
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    (db.insert as jest.Mock).mockReturnValue({ values });

    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    (db.update as jest.Mock).mockReturnValue({ set });

    return { set };
  }

  describe("getSubscriptionDatesFromPayload", () => {
    it("parses Polar snake_case current period dates", () => {
      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "sub_123",
          current_period_start: "2026-06-01T00:00:00.000Z",
          current_period_end: "2026-07-01T00:00:00.000Z",
        },
      });

      expect(result.startsAt?.toISOString()).toBe(
        "2026-06-01T00:00:00.000Z"
      );
      expect(result.endsAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    });

    it("parses Better Auth camelCase current period dates", () => {
      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "sub_123",
          currentPeriodStart: "2026-06-01T00:00:00.000Z",
          currentPeriodEnd: "2026-07-01T00:00:00.000Z",
        },
      });

      expect(result.startsAt?.toISOString()).toBe(
        "2026-06-01T00:00:00.000Z"
      );
      expect(result.endsAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    });

    it("parses SDK Date objects from validated webhook payloads", () => {
      const startsAt = new Date("2026-06-01T00:00:00.000Z");
      const endsAt = new Date("2026-07-01T00:00:00.000Z");

      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "sub_123",
          currentPeriodStart: startsAt,
          currentPeriodEnd: endsAt,
        },
      });

      expect(result.startsAt?.toISOString()).toBe(
        "2026-06-01T00:00:00.000Z"
      );
      expect(result.endsAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(result.startsAt).not.toBe(startsAt);
      expect(result.endsAt).not.toBe(endsAt);
    });

    it("parses nested subscription dates from order events", () => {
      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "order_123",
          subscription: {
            id: "sub_123",
            current_period_start: "2026-08-01T00:00:00.000Z",
            current_period_end: "2026-09-01T00:00:00.000Z",
          },
        },
      });

      expect(result.startsAt?.toISOString()).toBe(
        "2026-08-01T00:00:00.000Z"
      );
      expect(result.endsAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    });

    it("parses nested SDK Date objects from order subscription payloads", () => {
      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "order_123",
          subscription: {
            id: "sub_123",
            currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
            currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
          },
        },
      });

      expect(result.startsAt?.toISOString()).toBe(
        "2026-08-01T00:00:00.000Z"
      );
      expect(result.endsAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    });

    it("returns null dates for missing or invalid values", () => {
      const result = getSubscriptionDatesFromPayload({
        data: {
          id: "sub_123",
          current_period_start: "not-a-date",
          current_period_end: "",
        },
      });

      expect(result).toEqual({ startsAt: null, endsAt: null });
    });
  });

  describe("handleSubscriptionCreated", () => {
    it("acknowledges the event without activating access", async () => {
      const { set } = mockWebhookClaim();

      await handleSubscriptionCreated({
        id: "evt_123",
        type: "subscription.created",
        data: {
          id: "sub_123",
          status: "active",
          product_id: "prod_plus",
          customer_id: "cus_123",
        },
      });

      expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
      expect(
        subscriptionService.resetUsageCountersWithDates
      ).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          resultStatus: "success",
          resultMessage:
            "Subscription created acknowledged; waiting for subscription.active or order.paid",
        })
      );
    });
  });

  describe("subscription lifecycle handlers", () => {
    it("does not activate access for unknown subscription products", async () => {
      const { set } = mockWebhookClaim();
      (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
        id: "org_123",
        subscriptionStatus: "none",
        subscriptionId: null,
        polarCustomerId: "cus_123",
        usagePeriodStart: null,
        usagePeriodEnd: null,
      });

      await handleSubscriptionActive({
        id: "evt_active_unknown",
        type: "subscription.active",
        data: {
          id: "sub_123",
          product_id: "prod_unknown",
          customer_id: "cus_123",
          metadata: { referenceId: "org_123" },
          current_period_start: "2026-06-01T00:00:00.000Z",
          current_period_end: "2026-07-01T00:00:00.000Z",
        },
      });

      expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          resultStatus: "error",
          resultMessage: "Unknown product ID: prod_unknown",
        })
      );
    });

    it("defers pending next-period product updates", async () => {
      mockWebhookClaim();
      (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
        id: "org_123",
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        subscriptionId: "sub_123",
        polarCustomerId: "cus_123",
        usagePeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        usagePeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      });

      await handleSubscriptionUpdated({
        id: "evt_update_pending",
        type: "subscription.updated",
        data: {
          id: "sub_123",
          status: "active",
          product_id: "prod_plus",
          customer_id: "cus_123",
          current_period_start: "2026-06-01T00:00:00.000Z",
          current_period_end: "2026-07-01T00:00:00.000Z",
          pending_update: {
            product_id: "prod_plus",
            applies_at: "2999-01-01T00:00:00.000Z",
          },
        },
      });

      expect(subscriptionService.updateSubscription).toHaveBeenCalledWith(
        "org_123",
        expect.objectContaining({
          subscriptionPlan: "pro",
          subscriptionStatus: "active",
          subscriptionId: "sub_123",
        })
      );
    });

    it("defers camelCase pending product updates from SDK-shaped payloads", async () => {
      mockWebhookClaim();
      (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
        id: "org_123",
        subscriptionPlan: "pro",
        subscriptionStatus: "active",
        subscriptionId: "sub_123",
        polarCustomerId: "cus_123",
        usagePeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        usagePeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      });

      await handleSubscriptionUpdated({
        id: "evt_update_pending_camel",
        type: "subscription.updated",
        data: {
          id: "sub_123",
          status: "active",
          productId: "prod_plus",
          customerId: "cus_123",
          currentPeriodStart: "2026-06-01T00:00:00.000Z",
          currentPeriodEnd: "2026-07-01T00:00:00.000Z",
          pendingUpdate: {
            productId: "prod_plus",
            appliesAt: new Date("2999-01-01T00:00:00.000Z"),
          },
        },
      });

      expect(subscriptionService.updateSubscription).toHaveBeenCalledWith(
        "org_123",
        expect.objectContaining({
          subscriptionPlan: "pro",
          subscriptionStatus: "active",
          subscriptionId: "sub_123",
        })
      );
    });

    it("marks subscriptions past_due from the explicit Polar event", async () => {
      mockWebhookClaim();
      (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
        id: "org_123",
        subscriptionPlan: "plus",
        subscriptionStatus: "active",
        subscriptionId: "sub_123",
        polarCustomerId: "cus_123",
        usagePeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        usagePeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      });

      await handleSubscriptionPastDue({
        id: "evt_past_due",
        type: "subscription.past_due",
        data: {
          id: "sub_123",
          status: "past_due",
          product_id: "prod_plus",
          customer_id: "cus_123",
          current_period_start: "2026-06-01T00:00:00.000Z",
          current_period_end: "2026-07-01T00:00:00.000Z",
        },
      });

      expect(subscriptionService.updateSubscription).toHaveBeenCalledWith(
        "org_123",
        expect.objectContaining({
          subscriptionPlan: "plus",
          subscriptionStatus: "past_due",
          subscriptionId: "sub_123",
        })
      );
    });
  });
});

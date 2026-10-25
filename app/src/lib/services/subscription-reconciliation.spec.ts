/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { query: { organization: { findFirst: jest.fn(), findMany: jest.fn() } }, transaction: jest.fn() } }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: jest.fn(() => true), getPolarConfig: jest.fn(() => ({ accessToken: "test", server: "sandbox" })) }));
jest.mock("./subscription-service", () => ({ subscriptionService: { updateSubscription: jest.fn(), resetUsageCountersWithDates: jest.fn().mockResolvedValue(false) } }));
jest.mock("./billing-settings.service", () => ({ billingSettingsService: { resetNotificationsForPeriod: jest.fn() } }));
jest.mock("@/lib/execution/trial-lifecycle", () => ({ restoreTrialSuspensions: jest.fn() }));

import { db } from "@/utils/db";
import { subscriptionService } from "./subscription-service";
import { billingSettingsService } from "./billing-settings.service";
import { reconcilePolarSubscription } from "./subscription-reconciliation";

const org = { id: "org-1", polarCustomerId: "cus-1", subscriptionId: "sub-1", subscriptionPlan: "plus", subscriptionStatus: "active",
  polarWebhookTimestamp: new Date("2026-10-01T00:00:00Z"), polarWebhookEventKey: "old-event", polarRetiredSubscriptionIds: [] };
const snapshot = { id: "sub-1", customer_id: "cus-1", product_id: "product-plus", status: "active", cancel_at_period_end: false,
  created_at: "2026-10-01T00:00:00Z", modified_at: "2026-10-25T00:00:00Z", current_period_start: "2026-10-01T00:00:00Z", current_period_end: "2026-11-01T00:00:00Z" };

describe("authoritative Polar subscription reconciliation", () => {
  const originalFetch = global.fetch;
  let locked: typeof org;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POLAR_PLUS_PRODUCT_ID = "product-plus";
    process.env.POLAR_PRO_PRODUCT_ID = "product-pro";
    locked = { ...org };
    jest.mocked(db.query.organization.findFirst).mockResolvedValue(org as never);
    const tx = { select: () => ({ from: () => ({ where: () => ({ for: async () => [locked] }) }) }),
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })) };
    jest.mocked(db.transaction).mockImplementation(async (callback) => callback(tx as never));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
  });
  afterAll(() => { global.fetch = originalFetch; });

  it.each([ ["unpaid", "none", null], ["active", "active", "plus"], ["past_due", "past_due", "plus"] ] as const)
    ("repairs missed %s state without requesting a paid action", async (status, localStatus, plan) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, status }) });
      await expect(reconcilePolarSubscription("org-1")).resolves.toBe(true);
      expect(subscriptionService.updateSubscription).toHaveBeenCalledWith("org-1", expect.objectContaining({ subscriptionStatus: localStatus, subscriptionPlan: plan }), expect.anything());
      expect(global.fetch).toHaveBeenCalledWith("https://sandbox-api.polar.sh/v1/subscriptions/sub-1", expect.objectContaining({ headers: expect.objectContaining({ "Polar-Version": "2026-10" }), signal: expect.any(AbortSignal) }));
    });
  it("preserves scheduled cancellation access and resets notifications only for an actual rollover", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, cancel_at_period_end: true }) });
    jest.mocked(subscriptionService.resetUsageCountersWithDates).mockResolvedValueOnce(true);
    await reconcilePolarSubscription("org-1");
    expect(subscriptionService.updateSubscription).toHaveBeenCalledWith("org-1", expect.objectContaining({ subscriptionStatus: "canceled" }), expect.anything());
    expect(billingSettingsService.resetNotificationsForPeriod).toHaveBeenCalledTimes(1);
  });
  it("discards a fetch if a webhook changed the cursor in flight", async () => {
    locked = { ...org, polarWebhookEventKey: "newer-webhook" };
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(false);
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it.each([{ customer_id: "another-customer" }, { product_id: "unknown-product" }, { status: "unknown" }, { current_period_end: "invalid" }])
    ("rejects an invalid or mismatched snapshot: %p", async (override) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, ...override }) });
      await expect(reconcilePolarSubscription("org-1")).rejects.toThrow();
      expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
    });
  it.each([404, 429, 503])("does not revoke access on an HTTP %i lookup failure", async (status) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status });
    await expect(reconcilePolarSubscription("org-1")).rejects.toThrow();
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
});

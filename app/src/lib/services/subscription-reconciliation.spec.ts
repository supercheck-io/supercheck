/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { query: { organization: { findFirst: jest.fn(), findMany: jest.fn() } }, transaction: jest.fn() } }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: jest.fn(() => true), getPolarConfig: jest.fn(() => ({ accessToken: "test", server: "sandbox" })) }));
jest.mock("./subscription-service", () => ({ subscriptionService: { updateSubscription: jest.fn(), resetUsageCountersWithDates: jest.fn().mockResolvedValue(false) } }));
jest.mock("./billing-settings.service", () => ({ billingSettingsService: { resetNotificationsForPeriod: jest.fn() } }));
jest.mock("@/lib/execution/trial-lifecycle", () => ({ restoreTrialSuspensions: jest.fn() }));

import { db } from "@/utils/db";
import { isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService } from "./subscription-service";
import { billingSettingsService } from "./billing-settings.service";
import { reconcilePolarSubscription, reconcilePolarSubscriptions } from "./subscription-reconciliation";

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
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot, status }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cus-1", active_subscriptions: [] }) });
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
  it("requests retry if another update changed the cursor in flight", async () => {
    locked = { ...org, polarWebhookEventKey: "newer-webhook" };
    await expect(reconcilePolarSubscription("org-1")).rejects.toThrow("retry");
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it("rejects a lagging active snapshot after a newer revocation", async () => {
    locked = { ...org, subscriptionPlan: null, subscriptionStatus: "none",
      polarWebhookTimestamp: new Date("2026-10-26T00:00:00Z") } as unknown as typeof org;
    jest.mocked(db.query.organization.findFirst).mockResolvedValue(locked as never);
    await expect(reconcilePolarSubscription("org-1")).rejects.toThrow("stale");
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it("ignores an older snapshot that already matches the complete local state", async () => {
    locked = { ...org, polarWebhookTimestamp: new Date("2026-10-26T00:00:00Z"),
      subscriptionStartedAt: new Date(snapshot.current_period_start), subscriptionEndsAt: new Date(snapshot.current_period_end),
      usagePeriodStart: new Date(snapshot.current_period_start), usagePeriodEnd: new Date(snapshot.current_period_end) } as typeof org;
    jest.mocked(db.query.organization.findFirst).mockResolvedValue(locked as never);
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
  it("recovers a missed initial activation only from the bound customer's unique recognized subscription", async () => {
    const initial = { ...org, subscriptionId: null, subscriptionPlan: null };
    jest.mocked(db.query.organization.findFirst).mockResolvedValue(initial as never);
    locked = initial as unknown as typeof org;
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cus-1", active_subscriptions: [{ id: "sub-1", product_id: "product-plus" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot });
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(true);
    expect(subscriptionService.updateSubscription).toHaveBeenCalledWith("org-1", expect.objectContaining({ subscriptionId: "sub-1" }), expect.anything());
  });
  it("does not restore a retired subscription", async () => {
    locked = { ...org, polarRetiredSubscriptionIds: ["sub-1"] } as typeof org;
    await expect(reconcilePolarSubscription("org-1")).rejects.toThrow("Retired");
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it("recovers a missed replacement activation and retires the old binding", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot, status: "unpaid" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cus-1", active_subscriptions: [{ id: "sub-2", product_id: "product-pro" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...snapshot, id: "sub-2", product_id: "product-pro" }) });
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(true);
    expect(subscriptionService.updateSubscription).toHaveBeenCalledWith("org-1", expect.objectContaining({ subscriptionId: "sub-2", subscriptionPlan: "pro" }), expect.anything());
  });
  it("does not apply a pending future product", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot,
      pending_update: { product_id: "product-plus", applies_at: "2099-01-01T00:00:00Z" } }) });
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(false);
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it("rejects ambiguous customer state instead of choosing a subscription", async () => {
    jest.mocked(db.query.organization.findFirst).mockResolvedValue({ ...org, subscriptionId: null } as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "cus-1", active_subscriptions: [
      { id: "sub-1", product_id: "product-plus" }, { id: "sub-2", product_id: "product-pro" },
    ] }) });
    await expect(reconcilePolarSubscription("org-1")).rejects.toThrow("Multiple");
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
  it("does nothing in self-hosted mode", async () => {
    jest.mocked(isPolarEnabled).mockReturnValueOnce(false);
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("does nothing without a bound customer", async () => {
    jest.mocked(db.query.organization.findFirst).mockResolvedValue({ ...org, polarCustomerId: null } as never);
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("uses the creation timestamp when Polar has never modified the subscription", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...snapshot, modified_at: null }) });
    await expect(reconcilePolarSubscription("org-1")).resolves.toBe(true);
  });
  it("scans bound customers under the caller's lease and isolates lookup failures", async () => {
    jest.mocked(db.query.organization.findMany).mockResolvedValueOnce([{ id: "org-1" }, { id: "org-2" }] as never);
    const assertOwned = jest.fn();
    global.fetch = jest.fn().mockRejectedValue(new Error("provider unavailable"));
    await reconcilePolarSubscriptions(assertOwned);
    expect(assertOwned).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(subscriptionService.updateSubscription).not.toHaveBeenCalled();
  });
});

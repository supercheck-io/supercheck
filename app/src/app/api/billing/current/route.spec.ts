/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/utils/db", () => ({ db: { query: { organization: { findFirst: jest.fn() } }, select: jest.fn() } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: {
  getOrganizationPlanSafe: jest.fn(), getUsageSafe: jest.fn(), getSubscriptionAccessStatus: jest.fn(),
} }));
jest.mock("@/lib/feature-flags", () => ({
  isCloudHosted: jest.fn(() => true),
  getPlanPricing: jest.fn(() => ({ monthlyPriceCents: 4900, name: "Plus" })),
}));
import { GET } from "./route";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getPlanPricing } from "@/lib/feature-flags";

describe("current billing subscription display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ organizationId: "org-1" });
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
      id: "org-1", polarCustomerId: "customer-1", usagePeriodStart: null,
      usagePeriodEnd: null, subscriptionStartedAt: null, subscriptionEndsAt: null,
    });
    (db.select as jest.Mock).mockReturnValue({ from: () => ({ where: async () => [{ count: 0 }] }) });
    (subscriptionService.getOrganizationPlanSafe as jest.Mock).mockResolvedValue({});
    const meter = { used: 0, included: 0, overage: 0 };
    (subscriptionService.getUsageSafe as jest.Mock).mockResolvedValue({
      playwrightMinutes: meter, k6VuMinutes: meter, aiCredits: meter, sreInvestigations: meter,
    });
  });

  it.each(["none", "canceled", "unpaid"])("does not fabricate an active plan or billing period for %s", async (status) => {
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({
      isActive: false, plan: "plus", status, reason: "expired",
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).subscription).toMatchObject({
      plan: null, basePriceCents: null, planName: null, status,
      currentPeriodStart: null, currentPeriodEnd: null, hasBillingCustomer: true,
    });
    expect(getPlanPricing).not.toHaveBeenCalled();
  });

  it("preserves the paid plan during payment recovery", async () => {
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({
      isActive: true, plan: "plus", status: "past_due",
    });
    const response = await GET();
    expect((await response.json()).subscription).toMatchObject({
      plan: "plus", status: "past_due", basePriceCents: 4900,
    });
  });
});

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
const getUserOrgRole = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: (...args: unknown[]) => getUserOrgRole(...args) }));
const getTrialSummary = jest.fn();
jest.mock("@/lib/execution/trial-limits", () => ({ getTrialSummary: (...args: unknown[]) => getTrialSummary(...args) }));
import { GET } from "./route";
import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { subscriptionService } from "@/lib/services/subscription-service";
import { getPlanPricing } from "@/lib/feature-flags";

describe("current billing subscription display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTrialSummary.mockResolvedValue(undefined);
    getUserOrgRole.mockResolvedValue("org_admin");
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "user-1", organizationId: "org-1" });
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

  it.each(["org_admin", "org_owner"])("serves the payload to an %s", async (role) => {
    getUserOrgRole.mockResolvedValue(role);
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({
      isActive: true, plan: "plus", status: "active",
    });
    expect((await GET()).status).toBe(200);
    expect(getUserOrgRole).toHaveBeenCalledWith("user-1", "org-1");
  });

  it.each(["project_admin", "project_editor", "project_viewer", null])(
    "refuses a member with role %s before reading any organization data",
    async (role) => {
      getUserOrgRole.mockResolvedValue(role);
      const response = await GET();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Insufficient permissions" });
      expect(db.query.organization.findFirst).not.toHaveBeenCalled();
      expect(subscriptionService.getUsageSafe).not.toHaveBeenCalled();
    },
  );

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

  it("does not advertise SSO even when a legacy plan enables it", async () => {
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({
      isActive: true, plan: "pro", status: "active",
    });
    (subscriptionService.getOrganizationPlanSafe as jest.Mock).mockResolvedValue({
      ssoEnabled: true, customDomains: true, dataRetentionDays: 30,
    });
    const response = await GET();
    const { planFeatures } = await response.json();
    expect(planFeatures).not.toHaveProperty("ssoEnabled");
    expect(planFeatures).toMatchObject({ customDomains: true, dataRetentionDays: 30 });
  });

  it("reports the free trial so the Subscription tab can show its allowances", async () => {
    getTrialSummary.mockResolvedValue({ active: true, expiresAt: "2026-11-15T00:00:00.000Z", daysRemaining: 9 });
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({ isActive: false, plan: null, status: "none", reason: "no_subscription" });
    (subscriptionService.getOrganizationPlanSafe as jest.Mock).mockResolvedValue({ plan: "plus", maxMonitors: 5, maxStatusPages: 2, maxProjects: 3, maxTeamMembers: 3, runningCapacity: 1, queuedCapacity: 5, customDomains: false, dataRetentionDays: 7, aggregatedDataRetentionDays: 30 });
    (subscriptionService.getUsageSafe as jest.Mock).mockResolvedValue({
      playwrightMinutes: { used: 1, included: 30, overage: 0 }, k6VuMinutes: { used: 10, included: 150, overage: 0 },
      aiCredits: { used: 0, included: 100, overage: 0 }, sreInvestigations: { used: 0, included: 5, overage: 0 },
    });
    const body = await (await GET()).json();
    expect(body.trial).toEqual({ active: true, expiresAt: "2026-11-15T00:00:00.000Z", daysRemaining: 9 });
    expect(body.subscription.plan).toBeNull();
    expect(body.usage.k6VuMinutes).toMatchObject({ used: 10, included: 150 });
  });

  it("counts pending invitations as reserved team seats", async () => {
    const counts = [0, 0, 0, 2, 3];
    let call = 0;
    (db.select as jest.Mock).mockImplementation(() => ({ from: () => ({ where: async () => [{ count: counts[call++] }] }) }));
    (subscriptionService.getOrganizationPlanSafe as jest.Mock).mockResolvedValue({ maxTeamMembers: 6 });
    (subscriptionService.getSubscriptionAccessStatus as jest.Mock).mockResolvedValue({ isActive: true, plan: "plus", status: "active" });
    const body = await (await GET()).json();
    expect(body.limits.teamMembers).toMatchObject({ current: 5, remaining: 1 });
  });
});

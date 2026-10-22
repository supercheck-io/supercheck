/** @jest-environment node */
import {
  SubscriptionService,
  SubscriptionAccessDeniedError,
} from "./subscription-service";
import { TRIAL_LIMITS } from "@/lib/execution/trial-limits";
import { db } from "@/utils/db";
import { isPolarEnabled } from "@/lib/feature-flags";

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      organization: { findFirst: jest.fn() },
      planLimits: { findFirst: jest.fn() },
      executionEntitlements: { findFirst: jest.fn() },
    },
  },
}));
jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(),
  getPolarConfig: jest.fn(),
}));

const org = jest.mocked(db.query.organization.findFirst);
const entitlement = jest.mocked(db.query.executionEntitlements.findFirst);
const planRow = jest.mocked(db.query.planLimits.findFirst);

const trial = (overrides: Record<string, unknown> = {}) => ({
  organizationId: "org",
  expiresAt: new Date(Date.now() + 86_400_000),
  runningCapacity: TRIAL_LIMITS.runningCapacity,
  queuedCapacity: TRIAL_LIMITS.queuedCapacity,
  k6MaxVus: TRIAL_LIMITS.k6MaxVus,
  playwrightBudgetMs: TRIAL_LIMITS.playwrightBudgetMs,
  playwrightUsedMs: 0,
  maxMonitors: TRIAL_LIMITS.maxMonitors,
  minCheckIntervalMinutes: TRIAL_LIMITS.minCheckIntervalMinutes,
  maxStatusPages: TRIAL_LIMITS.maxStatusPages,
  maxStatusPageSubscribers: TRIAL_LIMITS.maxStatusPageSubscribers,
  maxTeamMembers: TRIAL_LIMITS.maxTeamMembers,
  maxProjects: TRIAL_LIMITS.maxProjects,
  sreInvestigationUnits: TRIAL_LIMITS.sreInvestigationUnits,
  aiCredits: TRIAL_LIMITS.aiCredits,
  lifecycleEndedAt: null,
  ...overrides,
});
const unsubscribedOrg = {
  id: "org",
  subscriptionPlan: null,
  subscriptionStatus: "none",
  polarCustomerId: null,
  subscriptionEndsAt: null,
};

describe("trial access", () => {
  const service = new SubscriptionService();
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(isPolarEnabled).mockReturnValue(true);
    org.mockResolvedValue(unsubscribedOrg as never);
    entitlement.mockResolvedValue(trial() as never);
  });

  it("gives an active trial the product limits instead of a subscription error", async () => {
    await expect(service.getOrganizationPlan("org")).resolves.toMatchObject({
      maxMonitors: 5,
      minCheckIntervalMinutes: 5,
      maxStatusPages: 2,
      maxStatusPageSubscribers: 50,
      maxTeamMembers: 3,
      maxProjects: 3,
      aiCreditsIncluded: 100,
      sreInvestigationUnitsIncluded: "5",
      runningCapacity: 1,
      queuedCapacity: 5,
      customDomains: false,
      ssoEnabled: false,
    });
  });

  it("uses the same trial limits for display", async () => {
    await expect(service.getOrganizationPlanSafe("org")).resolves.toMatchObject(
      { maxMonitors: 5, maxStatusPages: 2 },
    );
  });

  it("honors per-organization adjustments stored on the entitlement", async () => {
    entitlement.mockResolvedValue(trial({ maxMonitors: 8 }) as never);
    await expect(service.getOrganizationPlan("org")).resolves.toMatchObject({
      maxMonitors: 8,
    });
  });

  it("lets a trial pass the subscription and customer gates, but not when paid access is required", async () => {
    await expect(service.blockUntilSubscribed("org")).resolves.toBeUndefined();
    await expect(
      service.requireValidPolarCustomer("org"),
    ).resolves.toBeUndefined();
    await expect(
      service.blockUntilSubscribed("org", { allowTrial: false }),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
    await expect(
      service.requireValidPolarCustomer("org", { allowTrial: false }),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
  });

  it("denies an expired trial like any unsubscribed organization", async () => {
    entitlement.mockResolvedValue(
      trial({ expiresAt: new Date(Date.now() - 1) }) as never,
    );
    await expect(service.getOrganizationPlan("org")).rejects.toThrow(
      "No active subscription",
    );
    await expect(service.blockUntilSubscribed("org")).rejects.toBeInstanceOf(
      SubscriptionAccessDeniedError,
    );
    await expect(
      service.requireValidPolarCustomer("org"),
    ).rejects.toBeInstanceOf(SubscriptionAccessDeniedError);
  });

  it("denies an organization that never had a trial", async () => {
    entitlement.mockResolvedValue(undefined as never);
    await expect(service.getOrganizationPlan("org")).rejects.toThrow(
      "No active subscription",
    );
    await expect(service.blockUntilSubscribed("org")).rejects.toBeInstanceOf(
      SubscriptionAccessDeniedError,
    );
  });

  it("prefers a paid plan over a lingering trial entitlement", async () => {
    org.mockResolvedValue({
      id: "org",
      subscriptionPlan: "plus",
      subscriptionStatus: "active",
      polarCustomerId: "cus",
      subscriptionEndsAt: null,
    } as never);
    jest
      .spyOn(
        service as unknown as { validatePolarCustomer: () => Promise<boolean> },
        "validatePolarCustomer",
      )
      .mockResolvedValue(true);
    planRow.mockResolvedValue({ plan: "plus", maxMonitors: 50 } as never);
    await expect(service.getOrganizationPlan("org")).resolves.toMatchObject({
      plan: "plus",
      maxMonitors: 50,
    });
  });

  it("does not apply trial limits in self-hosted mode", async () => {
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    planRow.mockResolvedValue({ plan: "unlimited", maxMonitors: 999 } as never);
    await expect(service.getOrganizationPlan("org")).resolves.toMatchObject({
      plan: "unlimited",
    });
    expect(entitlement).not.toHaveBeenCalled();
  });
});

import { getExecutionPolicy } from "@/lib/execution/execution-policy";
jest.mock("@/lib/execution/execution-policy", () => ({
  getExecutionPolicy: jest.fn(),
}));
/**
 * Plan Enforcement Middleware Tests
 * Tests for subscription plan limit enforcement
 */

// Mock the dependencies before imports
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    getOrganizationPlan: jest.fn(),
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      organization: {
        findFirst: jest.fn(),
      },
    },
  },
}));

import {
  checkMonitorLimit,
  checkCapacityLimits,
  checkUsageLimit,
  checkStatusPageLimit,
  checkTeamMemberLimit,
  checkProjectLimit,
  checkSubscriberLimit,
  checkFeatureAvailability,
} from "./plan-enforcement";
import { subscriptionService } from "@/lib/services/subscription-service";
import { isPolarEnabled } from "@/lib/feature-flags";
import { db } from "@/utils/db";

describe("Plan Enforcement Middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("checkMonitorLimit", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should always allow in self-hosted mode", async () => {
        const result = await checkMonitorLimit("org-1", 100);
        expect(result.allowed).toBe(true);
      });

      it("should allow unlimited monitors in self-hosted mode", async () => {
        const result = await checkMonitorLimit("org-1", 999);
        expect(result.allowed).toBe(true);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("should allow when under limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit("org-1", 10);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(25);
        expect(result.remaining).toBe(15);
      });

      it("should reject when at limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit("org-1", 25);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain("Monitor limit reached");
        expect(result.currentPlan).toBe("plus");
        expect(result.upgrade).toBe("pro");
      });

      it("should reject when over limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit("org-1", 30);
        expect(result.allowed).toBe(false);
      });

      it("should not suggest upgrade for pro plan", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "pro",
          maxMonitors: 100,
        });

        const result = await checkMonitorLimit("org-1", 100);
        expect(result.upgrade).toBeUndefined();
      });

      it("should handle subscription errors", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockRejectedValue(new Error("No active subscription"));

        const result = await checkMonitorLimit("org-1", 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain("No active subscription");
        expect(result.requiresSubscription).toBe(true);
        expect(result.availablePlans).toEqual(["plus", "pro"]);
      });
    });
  });

  describe("checkCapacityLimits", () => {
    it("uses the authoritative execution policy limits", async () => {
      jest
        .mocked(getExecutionPolicy)
        .mockResolvedValue({
          tier: "trial",
          priority: 1,
          runningCapacity: 1,
          queuedCapacity: 10,
          expiresAt: new Date(),
          k6MaxVus: 5,
          k6RemainingVuMs: 9_000_000, playwrightRemainingMs: 1000,
        });
      await expect(checkCapacityLimits("org-1")).resolves.toEqual({
        runningCapacity: 1,
        queuedCapacity: 10,
      });
    });
    it("propagates admission failure without default cloud capacity", async () => {
      jest
        .mocked(getExecutionPolicy)
        .mockRejectedValue(new Error("Execution entitlement required"));
      await expect(checkCapacityLimits("org-1")).rejects.toThrow(
        "Execution entitlement required",
      );
    });
  });

  describe("checkUsageLimit", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should always allow with zero overage", async () => {
        const result = await checkUsageLimit("org-1", "playwright", 100);
        expect(result.allowed).toBe(true);
        expect(result.overage).toBe(0);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
        (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
          id: "org-1",
          playwrightMinutesUsed: 2000,
          k6VuMinutesUsed: 5000,
        });
      });

      it("should calculate playwright overage correctly", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          playwrightMinutesIncluded: 2500,
        });

        const result = await checkUsageLimit("org-1", "playwright", 100);
        expect(result.allowed).toBe(true);
        expect(result.currentUsage).toBe(2000);
        expect(result.included).toBe(2500);
        // After adding 100: 2100, still under 2500
        expect(result.willExceed).toBe(false);
      });

      it("should flag when will exceed included quota", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          playwrightMinutesIncluded: 2500,
        });

        const result = await checkUsageLimit("org-1", "playwright", 600);
        expect(result.allowed).toBe(true); // Still allowed, but with overage
        expect(result.willExceed).toBe(true);
        expect(result.overage).toBe(100); // 2000 + 600 = 2600 - 2500 = 100 overage
      });

      it("should calculate K6 overage correctly", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          k6VuMinutesIncluded: 6000,
        });

        const result = await checkUsageLimit("org-1", "k6", 2000);
        expect(result.currentUsage).toBe(5000);
        expect(result.included).toBe(6000);
        // After adding 2000: 7000 - 6000 = 1000 overage
        expect(result.overage).toBe(1000);
        expect(result.willExceed).toBe(true);
      });

      it("should throw for missing organization", async () => {
        (db.query.organization.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(
          checkUsageLimit("org-1", "playwright", 100),
        ).rejects.toThrow("Organization not found");
      });
    });
  });

  describe("checkStatusPageLimit", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should always allow in self-hosted mode", async () => {
        const result = await checkStatusPageLimit("org-1", 50);
        expect(result.allowed).toBe(true);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("should allow when under limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxStatusPages: 5,
        });

        const result = await checkStatusPageLimit("org-1", 3);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2);
      });

      it("should reject when at limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxStatusPages: 5,
        });

        const result = await checkStatusPageLimit("org-1", 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain("Status page limit reached");
      });
    });
  });

  describe("checkTeamMemberLimit", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should always allow in self-hosted mode", async () => {
        const result = await checkTeamMemberLimit("org-1", 100);
        expect(result.allowed).toBe(true);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("should allow when under limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxTeamMembers: 5,
        });

        const result = await checkTeamMemberLimit("org-1", 3);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(5);
        expect(result.remaining).toBe(2);
      });

      it("should reject when at limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxTeamMembers: 5,
        });

        const result = await checkTeamMemberLimit("org-1", 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain("Team member limit reached");
      });

      it("should allow more members on Pro plan", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "pro",
          maxTeamMembers: 25,
        });

        const result = await checkTeamMemberLimit("org-1", 20);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5);
      });
    });
  });

  describe("checkSubscriberLimit", () => {
    it("is unlimited in self-hosted mode", async () => {
      (isPolarEnabled as jest.Mock).mockReturnValue(false);
      await expect(checkSubscriberLimit("org-1", 10_000)).resolves.toEqual({
        allowed: true,
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("allows while under the per status page limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({ plan: "plus", maxStatusPageSubscribers: 100 });
        const result = await checkSubscriberLimit("org-1", 40);
        expect(result).toMatchObject({
          allowed: true,
          limit: 100,
          remaining: 60,
          currentPlan: "plus",
        });
      });

      it("rejects at the limit and suggests Pro from Plus", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({ plan: "plus", maxStatusPageSubscribers: 100 });
        const result = await checkSubscriberLimit("org-1", 100);
        expect(result).toMatchObject({
          allowed: false,
          upgrade: "pro",
          currentPlan: "plus",
        });
        expect(result.error).toContain("Subscriber limit reached");
      });

      it("does not suggest an upgrade from the top plan", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({ plan: "pro", maxStatusPageSubscribers: 1000 });
        const result = await checkSubscriberLimit("org-1", 1000);
        expect(result.allowed).toBe(false);
        expect(result).toMatchObject({ upgrade: undefined });
      });

      it("denies with a subscription prompt when the plan cannot be loaded", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockRejectedValue(new Error("Subscription required"));
        await expect(checkSubscriberLimit("org-1", 1)).resolves.toMatchObject({
          allowed: false,
          requiresSubscription: true,
          error: "Subscription required",
        });
      });
    });
  });

  describe("checkProjectLimit", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should always allow in self-hosted mode", async () => {
        const result = await checkProjectLimit("org-1", 50);
        expect(result.allowed).toBe(true);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("should allow when under limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxProjects: 10,
        });

        const result = await checkProjectLimit("org-1", 5);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5);
      });

      it("should reject when at limit", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          maxProjects: 10,
        });

        const result = await checkProjectLimit("org-1", 10);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain("Project limit reached");
      });
    });
  });

  describe("checkFeatureAvailability", () => {
    describe("in self-hosted mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it("should allow custom domains", async () => {
        const customDomains = await checkFeatureAvailability(
          "org-1",
          "customDomains",
        );

        expect(customDomains.available).toBe(true);
      });
    });

    describe("in cloud mode", () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it("should check custom domains availability on Plus plan", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "plus",
          customDomains: false,
        });

        const result = await checkFeatureAvailability("org-1", "customDomains");
        expect(result.available).toBe(false);
        expect(result.error).toContain("not available");
        expect(result.error).toContain("plus");
      });

      it("should allow custom domains on Pro plan", async () => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue({
          plan: "pro",
          customDomains: true,
        });

        const result = await checkFeatureAvailability("org-1", "customDomains");
        expect(result.available).toBe(true);
      });
    });
  });

  describe("Plan Limits Matrix", () => {
    beforeEach(() => {
      (isPolarEnabled as jest.Mock).mockReturnValue(true);
    });

    describe("Plus plan limits", () => {
      const plusPlan = {
        plan: "plus",
        maxMonitors: 25,
        maxStatusPages: 5,
        maxTeamMembers: 5,
        maxProjects: 10,
        playwrightMinutesIncluded: 2500,
        k6VuMinutesIncluded: 6000,
        runningCapacity: 5,
        queuedCapacity: 50,
        customDomains: false,
      };

      beforeEach(() => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue(plusPlan);
      });

      it("should enforce 25 monitor limit", async () => {
        const result = await checkMonitorLimit("org-1", 25);
        expect(result.allowed).toBe(false);
      });

      it("should enforce 5 status page limit", async () => {
        const result = await checkStatusPageLimit("org-1", 5);
        expect(result.allowed).toBe(false);
      });

      it("should enforce 5 team member limit", async () => {
        const result = await checkTeamMemberLimit("org-1", 5);
        expect(result.allowed).toBe(false);
      });

      it("should enforce 10 project limit", async () => {
        const result = await checkProjectLimit("org-1", 10);
        expect(result.allowed).toBe(false);
      });
    });

    describe("Pro plan limits", () => {
      const proPlan = {
        plan: "pro",
        maxMonitors: 100,
        maxStatusPages: 20,
        maxTeamMembers: 25,
        maxProjects: 50,
        playwrightMinutesIncluded: 7500,
        k6VuMinutesIncluded: 40000,
        runningCapacity: 10,
        queuedCapacity: 100,
        customDomains: true,
      };

      beforeEach(() => {
        (
          subscriptionService.getOrganizationPlan as jest.Mock
        ).mockResolvedValue(proPlan);
      });

      it("should enforce 100 monitor limit", async () => {
        const allowed = await checkMonitorLimit("org-1", 50);
        const notAllowed = await checkMonitorLimit("org-1", 100);

        expect(allowed.allowed).toBe(true);
        expect(notAllowed.allowed).toBe(false);
      });

      it("should allow custom domains", async () => {
        const result = await checkFeatureAvailability("org-1", "customDomains");
        expect(result.available).toBe(true);
      });
    });
  });
});

describe("plan enforcement for an organization on a free trial", () => {
  // A trial reports plan "plus" so its limits flow through the same checks, but it is not the Plus plan.
  const trialPlan = {
    id: "trial",
    plan: "plus",
    maxMonitors: 5,
    maxStatusPages: 1,
    maxTeamMembers: 3,
    maxProjects: 1,
    maxStatusPageSubscribers: 50,
    customDomains: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (isPolarEnabled as jest.Mock).mockReturnValue(true);
    (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue(trialPlan);
  });

  it("calls the trial a free trial in the monitor limit message, not a plus plan", async () => {
    const result = await checkMonitorLimit("org-1", 5);
    expect(result.error).toContain("Your free trial allows 5 monitors");
    expect(result.error).not.toMatch(/plus plan/i);
  });

  it("tells a trial to subscribe to Plus rather than suggesting Pro", async () => {
    const result = await checkMonitorLimit("org-1", 5);
    expect(result.upgrade).toBe("plus");
  });

  it.each([
    ["status pages", () => checkStatusPageLimit("org-1", 1), "Your free trial allows 1 status pages"],
    ["team members", () => checkTeamMemberLimit("org-1", 3), "Your free trial allows 3 team members"],
    ["projects", () => checkProjectLimit("org-1", 1), "Your free trial allows 1 projects"],
    ["subscribers", () => checkSubscriberLimit("org-1", 50), "Your free trial allows 50 subscribers"],
  ])("names the free trial in the %s limit message", async (_name, run, expected) => {
    const result = await run();
    expect(result.allowed).toBe(false);
    expect(result.error).toContain(expected);
  });

  it("keeps naming a paid plan by its name", async () => {
    (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({ id: "p", plan: "plus", maxMonitors: 25 });
    const result = await checkMonitorLimit("org-1", 25);
    expect(result.error).toContain("Your plus plan allows 25 monitors");
    expect(result.upgrade).toBe("pro");
  });

  it("explains that custom domains are not part of the free trial", async () => {
    await expect(checkFeatureAvailability("org-1", "customDomains")).resolves.toEqual({
      available: false,
      error: "Custom domains are not available on your free trial. Please upgrade to use them.",
    });
  });
});

describe("checkFeatureAvailability when there is no active subscription or trial", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isPolarEnabled as jest.Mock).mockReturnValue(true);
  });

  it("answers with the reason instead of throwing, so an ended trial is not an 'unexpected error'", async () => {
    (subscriptionService.getOrganizationPlan as jest.Mock).mockRejectedValue(
      new Error("No active subscription. Please subscribe to a plan to continue."),
    );
    await expect(checkFeatureAvailability("org-1", "customDomains")).resolves.toEqual({
      available: false,
      error: "No active subscription. Please subscribe to a plan to continue.",
    });
  });

  it("still allows everything in self-hosted mode without asking for a plan", async () => {
    (isPolarEnabled as jest.Mock).mockReturnValue(false);
    await expect(checkFeatureAvailability("org-1", "customDomains")).resolves.toEqual({ available: true });
    expect(subscriptionService.getOrganizationPlan).not.toHaveBeenCalled();
  });
});

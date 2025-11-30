/**
 * Plan Enforcement Middleware Tests
 * Tests for subscription plan limit enforcement
 */

// Mock the dependencies before imports
jest.mock('@/lib/services/subscription-service', () => ({
  subscriptionService: {
    getOrganizationPlan: jest.fn(),
  },
}));

jest.mock('@/lib/feature-flags', () => ({
  isPolarEnabled: jest.fn(),
}));

jest.mock('@/utils/db', () => ({
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
  checkFeatureAvailability,
} from './plan-enforcement';
import { subscriptionService } from '@/lib/services/subscription-service';
import { isPolarEnabled } from '@/lib/feature-flags';
import { db } from '@/utils/db';

describe('Plan Enforcement Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkMonitorLimit', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow in self-hosted mode', async () => {
        const result = await checkMonitorLimit('org-1', 100);
        expect(result.allowed).toBe(true);
      });

      it('should allow unlimited monitors in self-hosted mode', async () => {
        const result = await checkMonitorLimit('org-1', 999);
        expect(result.allowed).toBe(true);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it('should allow when under limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit('org-1', 10);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(25);
        expect(result.remaining).toBe(15);
      });

      it('should reject when at limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit('org-1', 25);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('Monitor limit reached');
        expect(result.currentPlan).toBe('plus');
        expect(result.upgrade).toBe('pro');
      });

      it('should reject when over limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxMonitors: 25,
        });

        const result = await checkMonitorLimit('org-1', 30);
        expect(result.allowed).toBe(false);
      });

      it('should not suggest upgrade for pro plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'pro',
          maxMonitors: 100,
        });

        const result = await checkMonitorLimit('org-1', 100);
        expect(result.upgrade).toBeUndefined();
      });

      it('should handle subscription errors', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockRejectedValue(
          new Error('No active subscription')
        );

        const result = await checkMonitorLimit('org-1', 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('No active subscription');
        expect(result.requiresSubscription).toBe(true);
        expect(result.availablePlans).toEqual(['plus', 'pro']);
      });
    });
  });

  describe('checkCapacityLimits', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should use environment variables when set', async () => {
        process.env.RUNNING_CAPACITY = '20';
        process.env.QUEUED_CAPACITY = '200';

        const result = await checkCapacityLimits('org-1');
        expect(result.runningCapacity).toBe(20);
        expect(result.queuedCapacity).toBe(200);

        // Cleanup
        delete process.env.RUNNING_CAPACITY;
        delete process.env.QUEUED_CAPACITY;
      });

      it('should fall back to plan limits when env vars not set', async () => {
        delete process.env.RUNNING_CAPACITY;
        delete process.env.QUEUED_CAPACITY;

        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          runningCapacity: 999,
          queuedCapacity: 9999,
        });

        const result = await checkCapacityLimits('org-1');
        expect(result.runningCapacity).toBe(999);
        expect(result.queuedCapacity).toBe(9999);
      });

      it('should fall back to defaults when plan lookup fails', async () => {
        delete process.env.RUNNING_CAPACITY;
        delete process.env.QUEUED_CAPACITY;

        (subscriptionService.getOrganizationPlan as jest.Mock).mockRejectedValue(
          new Error('Plan not found')
        );

        const result = await checkCapacityLimits('org-1');
        expect(result.runningCapacity).toBe(5);
        expect(result.queuedCapacity).toBe(50);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
        delete process.env.RUNNING_CAPACITY;
        delete process.env.QUEUED_CAPACITY;
      });

      it('should return Plus plan limits', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          runningCapacity: 5,
          queuedCapacity: 50,
        });

        const result = await checkCapacityLimits('org-1');
        expect(result.runningCapacity).toBe(5);
        expect(result.queuedCapacity).toBe(50);
      });

      it('should return Pro plan limits', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          runningCapacity: 10,
          queuedCapacity: 100,
        });

        const result = await checkCapacityLimits('org-1');
        expect(result.runningCapacity).toBe(10);
        expect(result.queuedCapacity).toBe(100);
      });
    });
  });

  describe('checkUsageLimit', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow with zero overage', async () => {
        const result = await checkUsageLimit('org-1', 'playwright', 100);
        expect(result.allowed).toBe(true);
        expect(result.overage).toBe(0);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
        (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
          id: 'org-1',
          playwrightMinutesUsed: 2000,
          k6VuMinutesUsed: 5000,
        });
      });

      it('should calculate playwright overage correctly', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          playwrightMinutesIncluded: 2500,
        });

        const result = await checkUsageLimit('org-1', 'playwright', 100);
        expect(result.allowed).toBe(true);
        expect(result.currentUsage).toBe(2000);
        expect(result.included).toBe(2500);
        // After adding 100: 2100, still under 2500
        expect(result.willExceed).toBe(false);
      });

      it('should flag when will exceed included quota', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          playwrightMinutesIncluded: 2500,
        });

        const result = await checkUsageLimit('org-1', 'playwright', 600);
        expect(result.allowed).toBe(true); // Still allowed, but with overage
        expect(result.willExceed).toBe(true);
        expect(result.overage).toBe(100); // 2000 + 600 = 2600 - 2500 = 100 overage
      });

      it('should calculate K6 overage correctly', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          k6VuMinutesIncluded: 6000,
        });

        const result = await checkUsageLimit('org-1', 'k6', 2000);
        expect(result.currentUsage).toBe(5000);
        expect(result.included).toBe(6000);
        // After adding 2000: 7000 - 6000 = 1000 overage
        expect(result.overage).toBe(1000);
        expect(result.willExceed).toBe(true);
      });

      it('should throw for missing organization', async () => {
        (db.query.organization.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(checkUsageLimit('org-1', 'playwright', 100))
          .rejects.toThrow('Organization not found');
      });
    });
  });

  describe('checkStatusPageLimit', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow in self-hosted mode', async () => {
        const result = await checkStatusPageLimit('org-1', 50);
        expect(result.allowed).toBe(true);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it('should allow when under limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxStatusPages: 5,
        });

        const result = await checkStatusPageLimit('org-1', 3);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2);
      });

      it('should reject when at limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxStatusPages: 5,
        });

        const result = await checkStatusPageLimit('org-1', 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('Status page limit reached');
      });
    });
  });

  describe('checkTeamMemberLimit', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow in self-hosted mode', async () => {
        const result = await checkTeamMemberLimit('org-1', 100);
        expect(result.allowed).toBe(true);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it('should allow when under limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxTeamMembers: 5,
        });

        const result = await checkTeamMemberLimit('org-1', 3);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(5);
        expect(result.remaining).toBe(2);
      });

      it('should reject when at limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxTeamMembers: 5,
        });

        const result = await checkTeamMemberLimit('org-1', 5);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('Team member limit reached');
      });

      it('should allow more members on Pro plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'pro',
          maxTeamMembers: 25,
        });

        const result = await checkTeamMemberLimit('org-1', 20);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5);
      });
    });
  });

  describe('checkProjectLimit', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow in self-hosted mode', async () => {
        const result = await checkProjectLimit('org-1', 50);
        expect(result.allowed).toBe(true);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it('should allow when under limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxProjects: 10,
        });

        const result = await checkProjectLimit('org-1', 5);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(5);
      });

      it('should reject when at limit', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          maxProjects: 10,
        });

        const result = await checkProjectLimit('org-1', 10);
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('Project limit reached');
      });
    });
  });

  describe('checkFeatureAvailability', () => {
    describe('in self-hosted mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(false);
      });

      it('should always allow all features', async () => {
        const customDomains = await checkFeatureAvailability('org-1', 'customDomains');
        const sso = await checkFeatureAvailability('org-1', 'ssoEnabled');

        expect(customDomains.available).toBe(true);
        expect(sso.available).toBe(true);
      });
    });

    describe('in cloud mode', () => {
      beforeEach(() => {
        (isPolarEnabled as jest.Mock).mockReturnValue(true);
      });

      it('should check custom domains availability on Plus plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          customDomains: false,
        });

        const result = await checkFeatureAvailability('org-1', 'customDomains');
        expect(result.available).toBe(false);
        expect(result.error).toContain('not available');
        expect(result.error).toContain('plus');
      });

      it('should allow custom domains on Pro plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'pro',
          customDomains: true,
        });

        const result = await checkFeatureAvailability('org-1', 'customDomains');
        expect(result.available).toBe(true);
      });

      it('should check SSO availability on Plus plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'plus',
          ssoEnabled: false,
        });

        const result = await checkFeatureAvailability('org-1', 'ssoEnabled');
        expect(result.available).toBe(false);
        expect(result.error).toContain('SSO');
      });

      it('should allow SSO on Pro plan', async () => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue({
          plan: 'pro',
          ssoEnabled: true,
        });

        const result = await checkFeatureAvailability('org-1', 'ssoEnabled');
        expect(result.available).toBe(true);
      });
    });
  });

  describe('Plan Limits Matrix', () => {
    beforeEach(() => {
      (isPolarEnabled as jest.Mock).mockReturnValue(true);
    });

    describe('Plus plan limits', () => {
      const plusPlan = {
        plan: 'plus',
        maxMonitors: 25,
        maxStatusPages: 5,
        maxTeamMembers: 5,
        maxProjects: 10,
        playwrightMinutesIncluded: 2500,
        k6VuMinutesIncluded: 6000,
        runningCapacity: 5,
        queuedCapacity: 50,
        customDomains: false,
        ssoEnabled: false,
      };

      beforeEach(() => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue(plusPlan);
      });

      it('should enforce 25 monitor limit', async () => {
        const result = await checkMonitorLimit('org-1', 25);
        expect(result.allowed).toBe(false);
      });

      it('should enforce 5 status page limit', async () => {
        const result = await checkStatusPageLimit('org-1', 5);
        expect(result.allowed).toBe(false);
      });

      it('should enforce 5 team member limit', async () => {
        const result = await checkTeamMemberLimit('org-1', 5);
        expect(result.allowed).toBe(false);
      });

      it('should enforce 10 project limit', async () => {
        const result = await checkProjectLimit('org-1', 10);
        expect(result.allowed).toBe(false);
      });
    });

    describe('Pro plan limits', () => {
      const proPlan = {
        plan: 'pro',
        maxMonitors: 100,
        maxStatusPages: 20,
        maxTeamMembers: 25,
        maxProjects: 50,
        playwrightMinutesIncluded: 7500,
        k6VuMinutesIncluded: 40000,
        runningCapacity: 10,
        queuedCapacity: 100,
        customDomains: true,
        ssoEnabled: true,
      };

      beforeEach(() => {
        (subscriptionService.getOrganizationPlan as jest.Mock).mockResolvedValue(proPlan);
      });

      it('should enforce 100 monitor limit', async () => {
        const allowed = await checkMonitorLimit('org-1', 50);
        const notAllowed = await checkMonitorLimit('org-1', 100);

        expect(allowed.allowed).toBe(true);
        expect(notAllowed.allowed).toBe(false);
      });

      it('should allow custom domains', async () => {
        const result = await checkFeatureAvailability('org-1', 'customDomains');
        expect(result.available).toBe(true);
      });

      it('should allow SSO', async () => {
        const result = await checkFeatureAvailability('org-1', 'ssoEnabled');
        expect(result.available).toBe(true);
      });
    });
  });
});

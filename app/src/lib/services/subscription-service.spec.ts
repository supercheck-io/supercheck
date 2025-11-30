/**
 * Subscription Service Tests
 * 
 * Comprehensive test coverage for billing, usage tracking, and plan management
 * 
 * Test Categories:
 * - Plan Management (retrieval, validation, limits)
 * - Usage Tracking (Playwright, K6, AI credits)
 * - Polar Integration (customer validation, API handling)
 * - Security (tampering detection, unauthorized access)
 * - Edge Cases (concurrent operations, boundary conditions)
 */

import { SubscriptionService } from './subscription-service';

// Mock dependencies
jest.mock('@/utils/db', () => ({
  db: {
    query: {
      organization: { findFirst: jest.fn() },
      planLimits: { findFirst: jest.fn() },
    },
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(),
      })),
    })),
  },
}));

jest.mock('@/lib/feature-flags', () => ({
  isPolarEnabled: jest.fn(),
  getPolarConfig: jest.fn(),
}));

// Import mocked modules
import { db } from '@/utils/db';
import { isPolarEnabled, getPolarConfig } from '@/lib/feature-flags';

// Cast to jest.Mock for type safety
const mockIsPolarEnabled = isPolarEnabled as jest.Mock;
const mockGetPolarConfig = getPolarConfig as jest.Mock;
const mockDbQuery = db.query as jest.Mocked<typeof db.query>;
const mockDbUpdate = db.update as jest.Mock;

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  // Test data fixtures
  const testOrgId = 'org-test-123';
  const testPolarCustomerId = 'polar-cust-456';
  
  const mockOrganization = {
    id: testOrgId,
    name: 'Test Organization',
    subscriptionPlan: 'plus' as const,
    subscriptionStatus: 'active' as const,
    polarCustomerId: testPolarCustomerId,
    playwrightMinutesUsed: 100,
    k6VuMinutesUsed: 50,
    aiCreditsUsed: 10,
    usagePeriodStart: new Date('2024-01-01'),
    usagePeriodEnd: new Date('2024-01-31'),
    subscriptionStartedAt: new Date('2024-01-01'),
    subscriptionEndsAt: new Date('2024-01-31'),
  };

  const mockPlanLimits = {
    id: 'plan-plus',
    plan: 'plus' as const,
    maxMonitors: 50,
    minCheckIntervalMinutes: 5,
    playwrightMinutesIncluded: 1000,
    k6VuMinutesIncluded: 500,
    aiCreditsIncluded: 100,
    runningCapacity: 5,
    queuedCapacity: 50,
    maxTeamMembers: 10,
    maxOrganizations: 3,
    maxProjects: 20,
    maxStatusPages: 5,
    customDomains: false,
    ssoEnabled: false,
    dataRetentionDays: 90,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUnlimitedPlanLimits = {
    id: 'plan-unlimited',
    plan: 'unlimited' as const,
    maxMonitors: 999999,
    minCheckIntervalMinutes: 1,
    playwrightMinutesIncluded: 999999,
    k6VuMinutesIncluded: 999999,
    aiCreditsIncluded: 999999,
    runningCapacity: 999,
    queuedCapacity: 9999,
    maxTeamMembers: 999,
    maxOrganizations: 999,
    maxProjects: 999,
    maxStatusPages: 999,
    customDomains: true,
    ssoEnabled: true,
    dataRetentionDays: 365,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubscriptionService();
    
    // Default: cloud mode enabled
    mockIsPolarEnabled.mockReturnValue(true);
    mockGetPolarConfig.mockReturnValue({
      server: 'production',
      accessToken: 'test-token',
    });

    // Default mock implementations
    mockDbQuery.organization.findFirst.mockResolvedValue(mockOrganization);
    mockDbQuery.planLimits.findFirst.mockResolvedValue(mockPlanLimits);
    mockDbUpdate.mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });
    
    // Default: Polar API returns success
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: testPolarCustomerId }),
    });
  });

  // ==========================================================================
  // PLAN MANAGEMENT TESTS
  // ==========================================================================
  
  describe('Plan Management', () => {
    describe('getOrganizationPlan', () => {
      describe('Positive Cases', () => {
        it('should return plus plan limits for plus subscription', async () => {
          const result = await service.getOrganizationPlan(testOrgId);
          
          expect(result.plan).toBe('plus');
          expect(result.playwrightMinutesIncluded).toBe(1000);
          expect(mockDbQuery.organization.findFirst).toHaveBeenCalled();
        });

        it('should return pro plan limits for pro subscription', async () => {
          const proPlanLimits = { ...mockPlanLimits, plan: 'pro' as const, playwrightMinutesIncluded: 5000 };
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: 'pro',
          });
          mockDbQuery.planLimits.findFirst.mockResolvedValue(proPlanLimits);
          
          const result = await service.getOrganizationPlan(testOrgId);
          
          expect(result.plan).toBe('pro');
        });

        it('should return unlimited plan in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          mockDbQuery.planLimits.findFirst.mockResolvedValue(mockUnlimitedPlanLimits);
          
          const result = await service.getOrganizationPlan(testOrgId);
          
          expect(result.plan).toBe('unlimited');
          expect(result.playwrightMinutesIncluded).toBe(999999);
        });
      });

      describe('Negative Cases', () => {
        it('should throw error when organization not found', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue(null);
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('Organization not found');
        });

        it('should throw error when no active subscription in cloud mode', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: null,
            subscriptionStatus: 'none',
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('No active subscription');
        });

        it('should throw error when subscription is canceled', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionStatus: 'canceled',
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('No active subscription');
        });

        it('should throw error when subscription is past_due', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionStatus: 'past_due',
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('No active subscription');
        });
      });

      describe('Security Cases', () => {
        it('should detect unlimited plan in cloud mode as tampering', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: 'unlimited',
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('Invalid subscription plan detected');
        });

        it('should reject invalid plan names in cloud mode', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: 'enterprise' as object,
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('Invalid subscription plan');
        });

        it('should reject free plan in cloud mode', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: 'free' as object,
          });
          
          await expect(service.getOrganizationPlan(testOrgId))
            .rejects.toThrow('Invalid subscription plan');
        });
      });
    });

    describe('getOrganizationPlanSafe', () => {
      describe('Positive Cases', () => {
        it('should return actual plan for subscribed users', async () => {
          const result = await service.getOrganizationPlanSafe(testOrgId);
          
          expect(result.plan).toBe('plus');
        });

        it('should return plus plan limits for unsubscribed users (display)', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: null,
            subscriptionStatus: 'none',
            polarCustomerId: null,
          });
          
          const result = await service.getOrganizationPlanSafe(testOrgId);
          
          expect(result.plan).toBe('plus');
        });
      });

      describe('Security Cases', () => {
        it('should return blocked state for deleted Polar customer', async () => {
          mockFetch.mockResolvedValue({ ok: false, status: 404 });
          
          const result = await service.getOrganizationPlanSafe(testOrgId);
          
          expect(result.maxMonitors).toBe(0);
          expect(result.playwrightMinutesIncluded).toBe(0);
        });

        it('should return blocked state for unlimited plan in cloud mode', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: 'unlimited',
          });
          
          const result = await service.getOrganizationPlanSafe(testOrgId);
          
          expect(result.maxMonitors).toBe(0);
        });
      });
    });

    describe('getPlanLimits', () => {
      describe('Positive Cases', () => {
        it('should return plan limits from database', async () => {
          const result = await service.getPlanLimits('plus');
          
          expect(result.plan).toBe('plus');
          expect(mockDbQuery.planLimits.findFirst).toHaveBeenCalled();
        });

        it('should return blocked plan limits', async () => {
          const result = await service.getPlanLimits('blocked');
          
          expect(result.maxMonitors).toBe(0);
          expect(result.playwrightMinutesIncluded).toBe(0);
          expect(result.runningCapacity).toBe(0);
        });
      });

      describe('Negative Cases', () => {
        it('should throw error in cloud mode when plan not found', async () => {
          mockDbQuery.planLimits.findFirst.mockResolvedValue(null);
          
          await expect(service.getPlanLimits('plus'))
            .rejects.toThrow('Plan limits not found');
        });

        it('should fallback to unlimited in self-hosted mode when plan not found', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          mockDbQuery.planLimits.findFirst.mockResolvedValue(null);
          
          const result = await service.getPlanLimits('plus');
          
          expect(result.maxMonitors).toBe(999999);
          expect(result.playwrightMinutesIncluded).toBe(999999);
        });
      });
    });
  });

  // ==========================================================================
  // USAGE TRACKING TESTS
  // ==========================================================================

  describe('Usage Tracking', () => {
    describe('trackPlaywrightUsage', () => {
      describe('Positive Cases', () => {
        it('should track Playwright minutes in cloud mode', async () => {
          await service.trackPlaywrightUsage(testOrgId, 30);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should not track in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await service.trackPlaywrightUsage(testOrgId, 30);
          
          expect(mockDbUpdate).not.toHaveBeenCalled();
        });
      });

      describe('Boundary Cases', () => {
        it('should track 0 minutes', async () => {
          await service.trackPlaywrightUsage(testOrgId, 0);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should track fractional minutes', async () => {
          await service.trackPlaywrightUsage(testOrgId, 0.5);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should track very large minutes', async () => {
          await service.trackPlaywrightUsage(testOrgId, 999999);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });
      });
    });

    describe('trackK6Usage', () => {
      describe('Positive Cases', () => {
        it('should track K6 VU minutes in cloud mode', async () => {
          await service.trackK6Usage(testOrgId, 100);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should not track in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await service.trackK6Usage(testOrgId, 100);
          
          expect(mockDbUpdate).not.toHaveBeenCalled();
        });
      });
    });

    describe('trackAIUsage', () => {
      describe('Positive Cases', () => {
        it('should track AI credits in cloud mode', async () => {
          await service.trackAIUsage(testOrgId, 1);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should default to 1 credit', async () => {
          await service.trackAIUsage(testOrgId);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should track multiple credits', async () => {
          await service.trackAIUsage(testOrgId, 5);
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should not track in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await service.trackAIUsage(testOrgId, 1);
          
          expect(mockDbUpdate).not.toHaveBeenCalled();
        });
      });
    });

    describe('getUsage', () => {
      describe('Positive Cases', () => {
        it('should return current usage with plan limits', async () => {
          const result = await service.getUsage(testOrgId);
          
          expect(result.playwrightMinutes.used).toBe(100);
          expect(result.playwrightMinutes.included).toBe(1000);
          expect(result.playwrightMinutes.overage).toBe(0);
        });

        it('should calculate overage correctly', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            playwrightMinutesUsed: 1500,
          });
          
          const result = await service.getUsage(testOrgId);
          
          expect(result.playwrightMinutes.overage).toBe(500);
        });

        it('should handle null usage values', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            playwrightMinutesUsed: null,
            k6VuMinutesUsed: null,
            aiCreditsUsed: null,
          });
          
          const result = await service.getUsage(testOrgId);
          
          expect(result.playwrightMinutes.used).toBe(0);
          expect(result.k6VuMinutes.used).toBe(0);
          expect(result.aiCredits.used).toBe(0);
        });
      });

      describe('Negative Cases', () => {
        it('should throw error when organization not found', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue(null);
          
          await expect(service.getUsage(testOrgId))
            .rejects.toThrow('Organization not found');
        });
      });

      describe('Boundary Cases', () => {
        it('should not have negative overage', async () => {
          const result = await service.getUsage(testOrgId);
          
          expect(result.playwrightMinutes.overage).toBeGreaterThanOrEqual(0);
          expect(result.k6VuMinutes.overage).toBeGreaterThanOrEqual(0);
          expect(result.aiCredits.overage).toBeGreaterThanOrEqual(0);
        });
      });
    });

    describe('getUsageSafe', () => {
      describe('Positive Cases', () => {
        it('should return usage even for unsubscribed users', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: null,
            subscriptionStatus: 'none',
            polarCustomerId: null,
          });
          
          const result = await service.getUsageSafe(testOrgId);
          
          expect(result.playwrightMinutes.used).toBeDefined();
        });
      });
    });
  });

  // ==========================================================================
  // SUBSCRIPTION MANAGEMENT TESTS
  // ==========================================================================

  describe('Subscription Management', () => {
    describe('hasActiveSubscription', () => {
      describe('Positive Cases', () => {
        it('should return true for active subscription in cloud mode', async () => {
          const result = await service.hasActiveSubscription(testOrgId);
          
          expect(result).toBe(true);
        });

        it('should return true in self-hosted mode always', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: null,
            subscriptionStatus: 'none',
          });
          
          const result = await service.hasActiveSubscription(testOrgId);
          
          expect(result).toBe(true);
        });
      });

      describe('Negative Cases', () => {
        it('should return false when organization not found', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue(null);
          
          const result = await service.hasActiveSubscription(testOrgId);
          
          expect(result).toBe(false);
        });

        it('should return false for canceled subscription', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionStatus: 'canceled',
          });
          
          const result = await service.hasActiveSubscription(testOrgId);
          
          expect(result).toBe(false);
        });

        it('should return false when Polar customer not found', async () => {
          mockFetch.mockResolvedValue({ ok: false, status: 404 });
          
          const result = await service.hasActiveSubscription(testOrgId);
          
          expect(result).toBe(false);
        });
      });
    });

    describe('updateSubscription', () => {
      describe('Positive Cases', () => {
        it('should update subscription plan to plus', async () => {
          await service.updateSubscription(testOrgId, {
            subscriptionPlan: 'plus',
            subscriptionStatus: 'active',
          });
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should update subscription plan to pro', async () => {
          await service.updateSubscription(testOrgId, {
            subscriptionPlan: 'pro',
            subscriptionStatus: 'active',
          });
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should update Polar customer ID', async () => {
          await service.updateSubscription(testOrgId, {
            polarCustomerId: 'new-polar-customer',
          });
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });

        it('should update subscription dates', async () => {
          await service.updateSubscription(testOrgId, {
            subscriptionStartedAt: new Date('2024-02-01'),
            subscriptionEndsAt: new Date('2024-02-28'),
          });
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });
      });

      describe('Security Cases', () => {
        it('should block unlimited plan in cloud mode', async () => {
          await expect(service.updateSubscription(testOrgId, {
            subscriptionPlan: 'unlimited',
          })).rejects.toThrow('Unlimited plan is only available in self-hosted mode');
        });

        it('should block invalid plan names in cloud mode', async () => {
          await expect(service.updateSubscription(testOrgId, {
            subscriptionPlan: 'enterprise' as object,
          })).rejects.toThrow('Invalid plan');
        });

        it('should allow unlimited plan in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await service.updateSubscription(testOrgId, {
            subscriptionPlan: 'unlimited',
          });
          
          expect(mockDbUpdate).toHaveBeenCalled();
        });
      });
    });

    describe('requiresSubscription', () => {
      it('should return true in cloud mode', () => {
        mockIsPolarEnabled.mockReturnValue(true);
        
        expect(service.requiresSubscription()).toBe(true);
      });

      it('should return false in self-hosted mode', () => {
        mockIsPolarEnabled.mockReturnValue(false);
        
        expect(service.requiresSubscription()).toBe(false);
      });
    });

    describe('blockUntilSubscribed', () => {
      describe('Positive Cases', () => {
        it('should not block with active subscription', async () => {
          await expect(service.blockUntilSubscribed(testOrgId))
            .resolves.not.toThrow();
        });

        it('should not block in self-hosted mode', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await expect(service.blockUntilSubscribed(testOrgId))
            .resolves.not.toThrow();
        });
      });

      describe('Negative Cases', () => {
        it('should block without subscription in cloud mode', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            subscriptionPlan: null,
            subscriptionStatus: 'none',
          });
          
          await expect(service.blockUntilSubscribed(testOrgId))
            .rejects.toThrow('Active subscription required');
        });
      });
    });
  });

  // ==========================================================================
  // POLAR INTEGRATION TESTS
  // ==========================================================================

  describe('Polar Integration', () => {
    describe('requireValidPolarCustomer', () => {
      describe('Positive Cases', () => {
        it('should pass with valid Polar customer', async () => {
          await expect(service.requireValidPolarCustomer(testOrgId))
            .resolves.not.toThrow();
        });

        it('should pass in self-hosted mode without customer', async () => {
          mockIsPolarEnabled.mockReturnValue(false);
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .resolves.not.toThrow();
        });
      });

      describe('Negative Cases', () => {
        it('should throw when organization not found', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue(null);
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .rejects.toThrow('Organization not found');
        });

        it('should throw when no Polar customer ID', async () => {
          mockDbQuery.organization.findFirst.mockResolvedValue({
            ...mockOrganization,
            polarCustomerId: null,
          });
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .rejects.toThrow('No Polar customer found');
        });

        it('should throw when Polar customer not found in API', async () => {
          mockFetch.mockResolvedValue({ ok: false, status: 404 });
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .rejects.toThrow('Polar customer not found');
        });
      });

      describe('Edge Cases', () => {
        it('should handle Polar API timeout', async () => {
          mockFetch.mockRejectedValue(Object.assign(new Error('Timeout'), { name: 'AbortError' }));
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .rejects.toThrow('Polar customer not found');
        });

        it('should handle Polar API server error', async () => {
          mockFetch.mockResolvedValue({ ok: false, status: 500 });
          
          await expect(service.requireValidPolarCustomer(testOrgId))
            .rejects.toThrow('Polar customer not found');
        });

        it('should use sandbox URL in sandbox mode', async () => {
          mockGetPolarConfig.mockReturnValue({
            server: 'sandbox',
            accessToken: 'test-token',
          });
          
          await service.requireValidPolarCustomer(testOrgId);
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('sandbox-api.polar.sh'),
            expect.any(Object)
          );
        });

        it('should use production URL in production mode', async () => {
          mockGetPolarConfig.mockReturnValue({
            server: 'production',
            accessToken: 'test-token',
          });
          
          await service.requireValidPolarCustomer(testOrgId);
          
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('api.polar.sh'),
            expect.any(Object)
          );
        });
      });
    });

    describe('Validation Caching', () => {
      it('should cache validation results', async () => {
        // First call - should hit API
        await service.requireValidPolarCustomer(testOrgId);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        
        // Second call - should use cache
        await service.requireValidPolarCustomer(testOrgId);
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      it('should not cache API errors', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        
        await expect(service.requireValidPolarCustomer(testOrgId))
          .rejects.toThrow();
        
        // Reset fetch to succeed
        mockFetch.mockResolvedValue({ ok: true, status: 200 });
        
        // Should retry API
        await service.requireValidPolarCustomer(testOrgId);
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ==========================================================================
  // USAGE RESET TESTS
  // ==========================================================================

  describe('Usage Reset', () => {
    describe('resetUsageCounters', () => {
      it('should reset all usage counters', async () => {
        await service.resetUsageCounters(testOrgId);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });

      it('should use existing subscription dates when available', async () => {
        await service.resetUsageCounters(testOrgId);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });

      it('should calculate 30-day period when no subscription dates', async () => {
        mockDbQuery.organization.findFirst.mockResolvedValue({
          ...mockOrganization,
          subscriptionStartedAt: null,
          subscriptionEndsAt: null,
        });
        
        await service.resetUsageCounters(testOrgId);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });
    });

    describe('resetUsageCountersWithDates', () => {
      it('should reset counters with provided dates', async () => {
        const startDate = new Date('2024-02-01');
        const endDate = new Date('2024-02-28');
        
        await service.resetUsageCountersWithDates(testOrgId, startDate, endDate);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });

      it('should use current date when start date is null', async () => {
        const endDate = new Date('2024-02-28');
        
        await service.resetUsageCountersWithDates(testOrgId, null, endDate);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });

      it('should calculate end date when end date is null', async () => {
        const startDate = new Date('2024-02-01');
        
        await service.resetUsageCountersWithDates(testOrgId, startDate, null);
        
        expect(mockDbUpdate).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // EFFECTIVE PLAN TESTS
  // ==========================================================================

  describe('getEffectivePlan', () => {
    describe('Positive Cases', () => {
      it('should return plan for subscribed users', async () => {
        const result = await service.getEffectivePlan(testOrgId);
        
        expect(result.plan).toBe('plus');
      });
    });

    describe('Negative Cases', () => {
      it('should throw descriptive error for unsubscribed users', async () => {
        mockDbQuery.organization.findFirst.mockResolvedValue({
          ...mockOrganization,
          subscriptionPlan: null,
          subscriptionStatus: 'none',
        });
        
        await expect(service.getEffectivePlan(testOrgId))
          .rejects.toThrow('Subscription required');
      });

      it('should re-throw other errors', async () => {
        mockDbQuery.organization.findFirst.mockRejectedValue(new Error('Database error'));
        
        await expect(service.getEffectivePlan(testOrgId))
          .rejects.toThrow('Database error');
      });
    });
  });

  // ==========================================================================
  // BOUNDARY AND EDGE CASES
  // ==========================================================================

  describe('Boundary Cases', () => {
    describe('Plan Limits', () => {
      it('should handle plan with zero limits', async () => {
        mockDbQuery.planLimits.findFirst.mockResolvedValue({
          ...mockPlanLimits,
          playwrightMinutesIncluded: 0,
          k6VuMinutesIncluded: 0,
          aiCreditsIncluded: 0,
        });
        
        const result = await service.getPlanLimits('plus');
        
        expect(result.playwrightMinutesIncluded).toBe(0);
      });

      it('should handle maximum plan limits', async () => {
        mockDbQuery.planLimits.findFirst.mockResolvedValue({
          ...mockPlanLimits,
          playwrightMinutesIncluded: Number.MAX_SAFE_INTEGER,
        });
        
        const result = await service.getPlanLimits('plus');
        
        expect(result.playwrightMinutesIncluded).toBe(Number.MAX_SAFE_INTEGER);
      });
    });

    describe('Organization IDs', () => {
      it('should handle empty organization ID', async () => {
        mockDbQuery.organization.findFirst.mockResolvedValue(null);
        
        await expect(service.getOrganizationPlan(''))
          .rejects.toThrow('Organization not found');
      });

      it('should handle very long organization ID', async () => {
        const longId = 'a'.repeat(1000);
        mockDbQuery.organization.findFirst.mockResolvedValue(null);
        
        await expect(service.getOrganizationPlan(longId))
          .rejects.toThrow('Organization not found');
      });

      it('should handle special characters in organization ID', async () => {
        const specialId = 'org-<script>alert(1)</script>';
        mockDbQuery.organization.findFirst.mockResolvedValue(null);
        
        await expect(service.getOrganizationPlan(specialId))
          .rejects.toThrow('Organization not found');
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent usage tracking calls', async () => {
        const promises = Array.from({ length: 10 }, () =>
          service.trackPlaywrightUsage(testOrgId, 5)
        );
        
        await expect(Promise.all(promises)).resolves.not.toThrow();
      });

      it('should handle concurrent plan lookups', async () => {
        const promises = Array.from({ length: 10 }, () =>
          service.getOrganizationPlan(testOrgId)
        );
        
        const results = await Promise.all(promises);
        results.forEach(result => {
          expect(result.plan).toBe('plus');
        });
      });
    });
  });

  // ==========================================================================
  // ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('Database Errors', () => {
      it('should propagate database connection errors', async () => {
        mockDbQuery.organization.findFirst.mockRejectedValue(
          new Error('Database connection failed')
        );
        
        await expect(service.getOrganizationPlan(testOrgId))
          .rejects.toThrow('Database connection failed');
      });

      it('should propagate database query errors', async () => {
        mockDbQuery.planLimits.findFirst.mockRejectedValue(
          new Error('Query timeout')
        );
        
        await expect(service.getPlanLimits('plus'))
          .rejects.toThrow('Query timeout');
      });
    });

    describe('API Errors', () => {
      it('should handle missing Polar config', async () => {
        mockGetPolarConfig.mockReturnValue(null);
        
        await expect(service.requireValidPolarCustomer(testOrgId))
          .rejects.toThrow();
      });

      it('should handle malformed API response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 0,
        });
        
        await expect(service.requireValidPolarCustomer(testOrgId))
          .rejects.toThrow();
      });
    });
  });
});

/**
 * Login Lockout Service Tests
 * 
 * Note: These tests require Redis to be running.
 * In CI environments, mock Redis or skip these tests.
 */

import {
  checkLockout,
  recordFailedAttempt,
  clearLockout,
  getAttemptCount,
} from "@/lib/security/login-lockout";

// Skip tests if no Redis available (mocked environment)
const itWithRedis = process.env.REDIS_URL ? it : it.skip;

describe("Login Lockout", () => {
  const testEmail = `test-${Date.now()}@example.com`;

  beforeEach(async () => {
    // Clear any existing lockout for test email
    await clearLockout(testEmail);
  });

  describe("checkLockout", () => {
    itWithRedis("should return not locked for new identifier", async () => {
      const result = await checkLockout(`new-${Date.now()}@test.com`);
      expect(result.isLocked).toBe(false);
      expect(result.attemptsRemaining).toBeGreaterThan(0);
    });
  });

  describe("recordFailedAttempt", () => {
    itWithRedis("should increment attempt count", async () => {
      const uniqueEmail = `attempt-${Date.now()}@test.com`;
      await recordFailedAttempt(uniqueEmail);
      const count = await getAttemptCount(uniqueEmail);
      expect(count).toBe(1);
    });

    itWithRedis("should return decreasing attempts remaining", async () => {
      const uniqueEmail = `remaining-${Date.now()}@test.com`;
      
      const result1 = await recordFailedAttempt(uniqueEmail);
      const result2 = await recordFailedAttempt(uniqueEmail);
      
      expect(result2.attemptsRemaining).toBeLessThanOrEqual(result1.attemptsRemaining);
    });
  });

  describe("clearLockout", () => {
    itWithRedis("should reset attempt count", async () => {
      const uniqueEmail = `clear-${Date.now()}@test.com`;
      
      // Create some attempts
      await recordFailedAttempt(uniqueEmail);
      await recordFailedAttempt(uniqueEmail);
      
      // Clear
      await clearLockout(uniqueEmail);
      
      // Verify cleared
      const count = await getAttemptCount(uniqueEmail);
      expect(count).toBe(0);
    });
  });

  describe("getAttemptCount", () => {
    itWithRedis("should return 0 for new identifier", async () => {
      const count = await getAttemptCount(`unknown-${Date.now()}@test.com`);
      expect(count).toBe(0);
    });
  });
});

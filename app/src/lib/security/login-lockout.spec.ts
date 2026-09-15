/**
 * Login Lockout Service Tests
 * 
 * Uses an in-memory Redis-compatible mock so lockout behavior is deterministic
 * and does not depend on a local Redis daemon.
 */

const mockStore = new Map<string, { value: string; expiresAt?: number }>();

function getEntry(key: string) {
  const entry = mockStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    mockStore.delete(key);
    return null;
  }
  return entry;
}

const mockRedis = {
  status: "ready",
  get: jest.fn(async (key: string) => getEntry(key)?.value ?? null),
  incr: jest.fn(async (key: string) => {
    const current = Number.parseInt(getEntry(key)?.value ?? "0", 10);
    const next = current + 1;
    mockStore.set(key, { value: String(next), expiresAt: getEntry(key)?.expiresAt });
    return next;
  }),
  expire: jest.fn(async (key: string, seconds: number) => {
    const entry = getEntry(key);
    if (!entry) return 0;
    mockStore.set(key, { ...entry, expiresAt: Date.now() + seconds * 1000 });
    return 1;
  }),
  setex: jest.fn(async (key: string, seconds: number, value: string) => {
    mockStore.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return "OK";
  }),
  ttl: jest.fn(async (key: string) => {
    const entry = getEntry(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }),
  del: jest.fn(async (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      if (mockStore.delete(key)) deleted += 1;
    }
    return deleted;
  }),
};

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(async () => mockRedis),
}));

import {
  checkLockout,
  recordFailedAttempt,
  clearLockout,
  getAttemptCount,
} from "@/lib/security/login-lockout";

describe("Login Lockout", () => {
  const testEmail = `test-${Date.now()}@example.com`;

  beforeEach(async () => {
    mockStore.clear();
    jest.clearAllMocks();
    // Clear any existing lockout for test email
    await clearLockout(testEmail);
  });

  describe("checkLockout", () => {
    it("should return not locked for new identifier", async () => {
      const result = await checkLockout(`new-${Date.now()}@test.com`);
      expect(result.isLocked).toBe(false);
      expect(result.attemptsRemaining).toBeGreaterThan(0);
    });
  });

  describe("recordFailedAttempt", () => {
    it("should increment attempt count", async () => {
      const uniqueEmail = `attempt-${Date.now()}@test.com`;
      await recordFailedAttempt(uniqueEmail);
      const count = await getAttemptCount(uniqueEmail);
      expect(count).toBe(1);
    });

    it("should return decreasing attempts remaining", async () => {
      const uniqueEmail = `remaining-${Date.now()}@test.com`;
      
      const result1 = await recordFailedAttempt(uniqueEmail);
      const result2 = await recordFailedAttempt(uniqueEmail);
      
      expect(result2.attemptsRemaining).toBeLessThanOrEqual(result1.attemptsRemaining);
    });
  });

  describe("clearLockout", () => {
    it("should reset attempt count", async () => {
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
    it("should return 0 for new identifier", async () => {
      const count = await getAttemptCount(`unknown-${Date.now()}@test.com`);
      expect(count).toBe(0);
    });
  });
});

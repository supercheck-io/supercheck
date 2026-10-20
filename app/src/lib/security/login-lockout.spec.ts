/**
 * Login Lockout Service Tests
 *
 * Uses an in-memory Redis-compatible mock so lockout behavior is deterministic
 * and does not depend on a local Redis daemon. The mock executes the service's
 * Lua scripts synchronously, which is the atomicity contract Redis provides.
 */

type Entry = { value: string; expiresAt?: number };

const mockStore = new Map<string, Entry>();

function getEntry(key: string): Entry | null {
  const entry = mockStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    mockStore.delete(key);
    return null;
  }
  return entry;
}

function ttlOf(key: string): number {
  const entry = getEntry(key);
  if (!entry) return -2;
  if (!entry.expiresAt) return -1;
  return Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
}

function incr(key: string): number {
  const next = Number.parseInt(getEntry(key)?.value ?? "0", 10) + 1;
  mockStore.set(key, { value: String(next), expiresAt: getEntry(key)?.expiresAt });
  return next;
}

function runScript(script: string, keys: string[], args: (string | number)[]): number[] | number {
  if (script.includes("INCR")) {
    const attemptsTtl = Number(args[0]);
    const thresholds: Array<[number, number]> = [];
    for (let index = 2; index < args.length; index += 2) {
      thresholds.push([Number(args[index]), Number(args[index + 1])]);
    }

    const keyCount = keys.length / 2;
    for (let index = 0; index < keyCount; index += 1) {
      const lockTtl = ttlOf(keys[index * 2 + 1]);
      if (lockTtl > 0) return [1, lockTtl];
    }

    const result: number[] = [0, 0];
    for (let index = 0; index < keyCount; index += 1) {
      const attemptsKey = keys[index * 2];
      const lockKey = keys[index * 2 + 1];
      const attempts = incr(attemptsKey);
      mockStore.set(attemptsKey, {
        value: String(attempts),
        expiresAt: Date.now() + attemptsTtl * 1000,
      });

      let applied = 0;
      for (const [threshold, seconds] of thresholds) {
        if (attempts >= threshold) applied = seconds;
      }

      if (applied > 0) {
        mockStore.set(lockKey, { value: String(args[1]), expiresAt: Date.now() + applied * 1000 });
        result[1] = Math.max(result[1], applied);
      }

      result.push(attempts, applied);
    }
    return result;
  }

  const keyCount = keys.length / 2;
  for (let index = 0; index < keyCount; index += 1) {
    const attemptsKey = keys[index * 2];
    const lockKey = keys[index * 2 + 1];
    const attempts = Number.parseInt(getEntry(attemptsKey)?.value ?? "0", 10);
    if (attempts > 0) {
      mockStore.set(attemptsKey, {
        value: String(attempts - 1),
        expiresAt: getEntry(attemptsKey)?.expiresAt,
      });
    }

    const applied = Number(args[index * 2]);
    if (applied > 0) {
      if (getEntry(lockKey)?.value === args[index * 2 + 1]) mockStore.delete(lockKey);
    }
  }
  return 1;
}

const mockRedis = {
  status: "ready",
  get: jest.fn(async (key: string) => getEntry(key)?.value ?? null),
  ttl: jest.fn(async (key: string) => ttlOf(key)),
  del: jest.fn(async (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) {
      if (mockStore.delete(key)) deleted += 1;
    }
    return deleted;
  }),
  multi: jest.fn(() => {
    const operations: Array<() => void> = [];
    const chain = {
      incr: (key: string) => {
        operations.push(() => { incr(key); });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        operations.push(() => {
          const entry = getEntry(key);
          if (entry) entry.expiresAt = Date.now() + seconds * 1000;
        });
        return chain;
      },
      exec: async () => {
        operations.forEach((operation) => operation());
        return [];
      },
    };
    return chain;
  }),
  eval: jest.fn(async (script: string, numKeys: number, ...args: (string | number)[]) =>
    runScript(script, args.slice(0, numKeys) as string[], args.slice(numKeys))),
};

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(async () => mockRedis),
}));

import { getRedisConnection } from "@/lib/queue";
import {
  LOGIN_LOCKOUT_INITIAL_ALLOWANCE,
  LOGIN_LOCKOUT_MESSAGE,
  blockingLockoutIdentifiers,
  checkLockout,
  clearLockout,
  emailLockoutIdentifier,
  emailIpLockoutIdentifier,
  getAttemptCount,
  ipLockoutIdentifier,
  recordEmailFailure,
  releaseLoginAttempt,
  reserveLoginAttempt,
  shouldRejectUnknownClientIp,
} from "@/lib/security/login-lockout";

describe("shouldRejectUnknownClientIp", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("stays permissive outside production by default", () => {
    delete process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN;
    Object.assign(process.env, { NODE_ENV: "test" });
    expect(shouldRejectUnknownClientIp()).toBe(false);
  });

  it.each(["true", "1"])(
    "enforces when explicitly enabled (%s)",
    (value) => {
      process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN = value;
      expect(shouldRejectUnknownClientIp()).toBe(true);
    }
  );

  it("enforces by default in cloud production", () => {
    delete process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN;
    delete process.env.SELF_HOSTED;
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(shouldRejectUnknownClientIp()).toBe(true);
  });

  it("stays permissive by default in self-hosted production", () => {
    delete process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN;
    process.env.SELF_HOSTED = "true";
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(shouldRejectUnknownClientIp()).toBe(false);
  });

  it("lets an explicit false override cloud production", () => {
    process.env.REQUIRE_CLIENT_IP_FOR_SIGNIN = "false";
    delete process.env.SELF_HOSTED;
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(shouldRejectUnknownClientIp()).toBe(false);
  });
});

const IP = "203.0.113.7";
const EMAIL = "user@example.test";

function identifiers(email = EMAIL, ip = IP): string[] {
  return blockingLockoutIdentifiers(email, ip);
}

async function reserveFailures(count: number, email = EMAIL, ip = IP): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const reservation = await reserveLoginAttempt(identifiers(email, ip));
    expect(reservation.isLocked).toBe(false);
    // Simulate the lockout window elapsing between failed attempts.
    for (const key of Array.from(mockStore.keys())) {
      if (key.includes(":locked:")) mockStore.delete(key);
    }
  }
}

describe("Login Lockout", () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    (getRedisConnection as jest.Mock).mockResolvedValue(mockRedis);
  });

  describe("identifier scoping", () => {
    it("blocks on IP and email+IP only, never on email alone", () => {
      expect(identifiers()).toEqual([
        ipLockoutIdentifier(IP),
        emailIpLockoutIdentifier(EMAIL, IP),
      ]);
      expect(identifiers()).not.toContain(emailLockoutIdentifier(EMAIL));
    });

    it("skips blocking dimensions when the client IP is unknown", () => {
      expect(blockingLockoutIdentifiers(EMAIL, "unknown")).toEqual([]);
      expect(blockingLockoutIdentifiers(EMAIL, "")).toEqual([]);
    });
  });

  describe("checkLockout", () => {
    it("is read-only and does not consume an attempt", async () => {
      const result = await checkLockout(identifiers()[0]);
      expect(result.isLocked).toBe(false);
      expect(result.attemptsRemaining).toBe(LOGIN_LOCKOUT_INITIAL_ALLOWANCE);
      expect(await getAttemptCount(identifiers()[0])).toBe(0);
    });
  });

  describe("reserveLoginAttempt", () => {
    it("counts the attempt before the credential check", async () => {
      const reservation = await reserveLoginAttempt(identifiers());
      expect(reservation.isLocked).toBe(false);
      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(1);
      expect(await getAttemptCount(emailIpLockoutIdentifier(EMAIL, IP))).toBe(1);
    });

    it("decreases attemptsRemaining down the ladder", async () => {
      const remaining: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        remaining.push((await reserveLoginAttempt(identifiers())).attemptsRemaining);
      }
      expect(remaining).toEqual([4, 3, 2, 1]);
    });

    it.each([
      [5, 30],
      [10, 300],
      [15, 900],
      [20, 3600],
    ])("locks after %i failures for %i seconds", async (failures, seconds) => {
      await reserveFailures(failures - 1);
      const reservation = await reserveLoginAttempt(identifiers());
      expect(reservation.isLocked).toBe(false);
      expect(reservation.releases.some((release) => release.appliedLockoutSeconds === seconds)).toBe(true);

      const blocked = await reserveLoginAttempt(identifiers());
      expect(blocked.isLocked).toBe(true);
      expect(blocked.lockoutSeconds).toBe(seconds);
      expect(blocked.message).toBe(LOGIN_LOCKOUT_MESSAGE);
    });

    it("does not increment counters or renew locks for a rejected request", async () => {
      await reserveFailures(4);
      const locking = await reserveLoginAttempt(identifiers());
      expect(locking.isLocked).toBe(false);

      const blocked = await reserveLoginAttempt(identifiers());
      expect(blocked.isLocked).toBe(true);

      const ttlBefore = ttlOf(`supercheck:login:lockout:locked:${ipLockoutIdentifier(IP)}`);
      const second = await reserveLoginAttempt(identifiers());
      const ttlAfter = ttlOf(`supercheck:login:lockout:locked:${ipLockoutIdentifier(IP)}`);

      expect(second.isLocked).toBe(true);
      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(5);
      expect(await getAttemptCount(emailIpLockoutIdentifier(EMAIL, IP))).toBe(5);
      expect(ttlAfter).toBeLessThanOrEqual(ttlBefore);
    });

    it("fails open when Redis is unavailable", async () => {
      (getRedisConnection as jest.Mock).mockResolvedValue(null);
      const reservation = await reserveLoginAttempt(identifiers());
      expect(reservation.isLocked).toBe(false);
      expect(reservation.releases).toEqual([]);
      expect(reservation.attemptsRemaining).toBe(LOGIN_LOCKOUT_INITIAL_ALLOWANCE);
    });
  });

  describe("concurrent bursts", () => {
    it("cannot exceed the remaining allowance", async () => {
      // Three failures recorded, so two attempts remain before the 5th locks.
      await reserveFailures(3);

      const burst = await Promise.all(
        Array.from({ length: 6 }, () => reserveLoginAttempt(identifiers()))
      );

      expect(burst.filter((reservation) => !reservation.isLocked)).toHaveLength(2);
      expect(burst.filter((reservation) => reservation.isLocked)).toHaveLength(4);
      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(5);
      expect(await getAttemptCount(emailIpLockoutIdentifier(EMAIL, IP))).toBe(5);
    });

    it("serializes the whole reservation in one atomic operation", async () => {
      await reserveLoginAttempt(identifiers());
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe("releaseLoginAttempt", () => {
    it("gives the attempt back when the password was never verified", async () => {
      const reservation = await reserveLoginAttempt(identifiers());
      await releaseLoginAttempt(reservation.releases);

      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(0);
      expect(await getAttemptCount(emailIpLockoutIdentifier(EMAIL, IP))).toBe(0);
    });

    it("does not remove a newer lock when an older threshold reservation settles late", async () => {
      await reserveFailures(4);
      const older = await reserveLoginAttempt(identifiers());
      for (const key of Array.from(mockStore.keys())) {
        if (key.includes(":locked:")) mockStore.delete(key);
      }
      const newer = await reserveLoginAttempt(identifiers());
      expect(newer.isLocked).toBe(false);
      await releaseLoginAttempt(older.releases);
      expect((await reserveLoginAttempt(identifiers())).isLocked).toBe(true);
    });

    it("removes a lock created by the released reservation", async () => {
      await reserveFailures(4);
      const reservation = await reserveLoginAttempt(identifiers());
      expect(reservation.isLocked).toBe(false);

      const blocked = await reserveLoginAttempt(identifiers());
      expect(blocked.isLocked).toBe(true);

      await releaseLoginAttempt(reservation.releases);

      const afterRelease = await reserveLoginAttempt(identifiers());
      expect(afterRelease.isLocked).toBe(false);
      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(5);
    });  });

  describe("recordEmailFailure", () => {
    it("counts telemetry without ever locking the email", async () => {
      for (let index = 0; index < 25; index += 1) {
        await recordEmailFailure(EMAIL);
      }

      expect(await getAttemptCount(emailLockoutIdentifier(EMAIL))).toBe(25);
      expect((await checkLockout(emailLockoutIdentifier(EMAIL))).isLocked).toBe(false);
    });
  });

  describe("clearLockout", () => {
    it("resets counters and any active lock", async () => {
      await reserveFailures(5);
      const locking = await reserveLoginAttempt(identifiers());
      expect(locking.releases.some((release) => release.appliedLockoutSeconds > 0)).toBe(true);
      expect((await reserveLoginAttempt(identifiers())).isLocked).toBe(true);

      await Promise.all(identifiers().map((identifier) => clearLockout(identifier)));

      expect(await getAttemptCount(ipLockoutIdentifier(IP))).toBe(0);
      expect((await reserveLoginAttempt(identifiers())).isLocked).toBe(false);
    });
  });
});

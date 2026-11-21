/** @jest-environment node */
import type Redis from "ioredis";
import { acquireOwnedLock } from "./cleanup-lock";

/** In-memory Redis with the SET NX PX and the two compare scripts the lock sends. */
function fakeRedis() {
  const store = new Map<string, { value: string; ttl: number }>();
  const redis = {
    store,
    failEval: false,
    set: jest.fn(async (key: string, value: string, _px: string, ttl: number, _nx: string) => {
      if (store.has(key)) return null;
      store.set(key, { value, ttl });
      return "OK";
    }),
    eval: jest.fn(async (script: string, _n: number, key: string, token: string, ttl?: string) => {
      if (redis.failEval) throw new Error("connection lost");
      const entry = store.get(key);
      if (!entry || entry.value !== token) return 0;
      if (script.includes("pexpire")) entry.ttl = Number(ttl);
      else store.delete(key);
      return 1;
    }),
  };
  return redis;
}

const options = { ttlMs: 45 * 60_000, renewEveryMs: 5 * 60_000 };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.useRealTimers());

it("acquires with SET NX PX and a random token, and a second owner is refused", async () => {
  const redis = fakeRedis();
  const lock = await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options);
  expect(lock).not.toBeNull();
  expect(redis.set).toHaveBeenCalledWith("cleanup:x:lock", expect.stringMatching(/^[0-9a-f-]{36}$/), "PX", options.ttlMs, "NX");
  expect(await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options)).toBeNull();
  await lock!.release();
});

it("renews the TTL on a timer while the owner holds the lock", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.store.get("cleanup:x:lock")!.ttl = 1;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(redis.store.get("cleanup:x:lock")!.ttl).toBe(options.ttlMs);
  expect(lock.signal.aborted).toBe(false);
  await lock.release();
});

it("aborts when renewal finds another owner's token, and release leaves the other owner's key", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.store.set("cleanup:x:lock", { value: "someone-else", ttl: options.ttlMs });
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(true);
  await lock.release();
  expect(redis.store.get("cleanup:x:lock")?.value).toBe("someone-else");
});

it("aborts when the key expired before renewal", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.store.delete("cleanup:x:lock");
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(true);
});

it("aborts when the renewal call fails, and stops renewing", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.failEval = true;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(true);
  const calls = redis.eval.mock.calls.length;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs * 3);
  expect(redis.eval.mock.calls.length).toBe(calls);
});

it("release deletes its own key, stops renewal and tolerates a Redis failure", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  await lock.release();
  expect(redis.store.has("cleanup:x:lock")).toBe(false);
  const calls = redis.eval.mock.calls.length;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs * 2);
  expect(redis.eval.mock.calls.length).toBe(calls);

  const again = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.failEval = true;
  await expect(again.release()).resolves.toBeUndefined();
});

it("stops renewing and aborts once held past maxHoldMs, so a hung holder lets the key lapse", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", { ...options, maxHoldMs: options.renewEveryMs * 2 }))!;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(false);
  const renewals = redis.eval.mock.calls.length;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(true);
  expect(redis.eval.mock.calls.length).toBe(renewals);
  await lock.release();
});

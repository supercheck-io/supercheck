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
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

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

it("tolerates a failed renewal and keeps renewing once Redis answers again", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.failEval = true;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(lock.signal.aborted).toBe(false);
  redis.failEval = false;
  redis.store.get("cleanup:x:lock")!.ttl = 1;
  await jest.advanceTimersByTimeAsync(options.renewEveryMs);
  expect(redis.store.get("cleanup:x:lock")!.ttl).toBe(options.ttlMs);
  expect(lock.signal.aborted).toBe(false);
  await lock.release();
});

it("aborts before the TTL can lapse when renewals keep failing, and stops renewing", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const redis = fakeRedis();
  // TTL 3 intervals: after two failed renewals the next attempt could come after expiry.
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", { ttlMs: 3_000, renewEveryMs: 1_000 }))!;
  redis.failEval = true;
  await jest.advanceTimersByTimeAsync(1_000);
  expect(lock.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(lock.signal.aborted).toBe(true);
  const calls = redis.eval.mock.calls.length;
  await jest.advanceTimersByTimeAsync(5_000);
  expect(redis.eval.mock.calls.length).toBe(calls);
});

it("aborts when a renewal never answers before the TTL could lapse", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", { ttlMs: 3_000, renewEveryMs: 1_000 }))!;
  redis.eval.mockImplementation(() => new Promise<0 | 1>(() => {}));
  await jest.advanceTimersByTimeAsync(2_000);
  expect(lock.signal.aborted).toBe(true);
});

it("a renewal that answers after release is not reported as a lost lock", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  errors.mockClear();
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  let answer!: (v: 0 | 1) => void;
  redis.eval.mockImplementationOnce(() => new Promise<0 | 1>((resolve) => (answer = resolve)));
  await jest.advanceTimersByTimeAsync(options.renewEveryMs); // renewal in flight
  await lock.release();
  answer(0);
  await jest.advanceTimersByTimeAsync(0);
  expect(lock.signal.aborted).toBe(false);
  expect(errors).not.toHaveBeenCalled();
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
  expect(again.key).toBe("cleanup:x:lock");
  expect(again.token).toBe(redis.store.get("cleanup:x:lock")!.value);
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

it("release gives up after a bounded wait when Redis does not answer", async () => {
  const redis = fakeRedis();
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options))!;
  redis.eval.mockImplementationOnce(() => new Promise<0 | 1>(() => {}));
  const released = lock.release();
  await jest.advanceTimersByTimeAsync(5_000);
  await expect(released).resolves.toBeUndefined();
});

it("fails acquisition after a bounded wait when Redis does not answer, and queues an undo of the SET", async () => {
  const redis = fakeRedis();
  redis.set.mockImplementationOnce(() => new Promise<"OK" | null>(() => {}));
  const pending = acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", options);
  const assertion = expect(pending).rejects.toThrow("acquisition timed out");
  await jest.advanceTimersByTimeAsync(10_000);
  await assertion;
  // Compare-and-delete with the abandoned token, queued after the SET on the same client.
  expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('"del"'), 1, "cleanup:x:lock", redis.set.mock.calls[0][1]);
});

it("refuses a lease whose reply came too late to be safe, and releases it", async () => {
  const redis = fakeRedis();
  redis.set.mockImplementationOnce(async (key: string, value: string, _px: string, ttl: number) => {
    jest.setSystemTime(Date.now() + 2_500); // the reply arrives 2.5 s after the send
    redis.store.set(key, { value, ttl });
    return "OK";
  });
  await expect(acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", { ttlMs: 3_000, renewEveryMs: 1_000 })).rejects.toThrow("too late");
  await jest.advanceTimersByTimeAsync(0);
  expect(redis.store.has("cleanup:x:lock")).toBe(false);
});

it("counts the lease from the send time, so a slow renewal reply cannot stretch it", async () => {
  const redis = fakeRedis();
  // TTL 3 s, renew every 1 s: each renewal reply comes 0.9 s after its send.
  const lock = (await acquireOwnedLock(redis as unknown as Redis, "cleanup:x:lock", { ttlMs: 3_000, renewEveryMs: 1_000 }))!;
  redis.eval.mockImplementation(() => new Promise<0 | 1>((resolve) => setTimeout(() => resolve(1), 900)));
  await jest.advanceTimersByTimeAsync(1_000); // renewal sent at 1.0 s, confirmed as of 1.0 s (reply at 1.9 s)
  await jest.advanceTimersByTimeAsync(1_000); // at 2.0 s: 2.0 - 1.0 + 1.0 < 3.0, keep going
  expect(lock.signal.aborted).toBe(false);
  redis.eval.mockImplementation(() => new Promise<0 | 1>(() => {})); // renewals stop answering
  await jest.advanceTimersByTimeAsync(2_000); // last confirmation is from 2.0 s; by 4.0 s it may lapse
  expect(lock.signal.aborted).toBe(true);
});

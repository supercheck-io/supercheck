import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { waitForRedisReady } from "./redis-ready";

const client = (status: string) => Object.assign(new EventEmitter(), { status }) as unknown as Redis;

describe("waitForRedisReady", () => {
  it("is true at once for a ready client", async () => {
    await expect(waitForRedisReady(client("ready"))).resolves.toBe(true);
  });
  it("is false at once for an ended client (closed for good)", async () => {
    await expect(waitForRedisReady(client("end"))).resolves.toBe(false);
  });
  it.each(["connecting", "connect", "wait", "reconnecting", "close"])(
    "waits for a %s client to become ready (cold start or failover)",
    async (status) => {
      const redis = client(status);
      const result = waitForRedisReady(redis);
      redis.emit("ready");
      await expect(result).resolves.toBe(true);
      expect(redis.listenerCount("ready")).toBe(0);
      expect(redis.listenerCount("end")).toBe(0);
    },
  );
  it("keeps waiting through a failed reconnect attempt (close is emitted before each retry)", async () => {
    const redis = client("reconnecting");
    const result = waitForRedisReady(redis);
    redis.emit("close");
    redis.emit("ready");
    await expect(result).resolves.toBe(true);
  });
  it("gives up when the client ends while waiting", async () => {
    const redis = client("reconnecting");
    const result = waitForRedisReady(redis);
    redis.emit("end");
    await expect(result).resolves.toBe(false);
  });
  it("gives up after the timeout, and a later call waits again", async () => {
    const redis = client("reconnecting");
    await expect(waitForRedisReady(redis, 10)).resolves.toBe(false);
    const again = waitForRedisReady(redis, 10);
    redis.emit("ready");
    await expect(again).resolves.toBe(true);
  });
  it("shares one wait across concurrent callers (one listener, not one per request)", async () => {
    const redis = client("reconnecting");
    const waits = Array.from({ length: 50 }, () => waitForRedisReady(redis));
    expect(redis.listenerCount("ready")).toBe(1);
    redis.emit("ready");
    await expect(Promise.all(waits)).resolves.toEqual(Array(50).fill(true));
  });
});

import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { waitForRedisReady } from "./redis-ready";

const client = (status: string) => Object.assign(new EventEmitter(), { status }) as unknown as Redis;

describe("waitForRedisReady", () => {
  it("is true at once for a ready client", async () => {
    await expect(waitForRedisReady(client("ready"))).resolves.toBe(true);
  });
  it.each(["reconnecting", "end", "close"])("is false at once while %s", async (status) => {
    await expect(waitForRedisReady(client(status))).resolves.toBe(false);
  });
  it("waits for a connecting client to become ready (concurrent cold start)", async () => {
    const redis = client("connecting");
    const result = waitForRedisReady(redis);
    redis.emit("ready");
    await expect(result).resolves.toBe(true);
    expect(redis.listenerCount("ready")).toBe(0);
  });
  it("gives up on a connecting client that closes", async () => {
    const redis = client("connect");
    const result = waitForRedisReady(redis);
    redis.emit("close");
    await expect(result).resolves.toBe(false);
  });
  it("gives up after the timeout", async () => {
    await expect(waitForRedisReady(client("wait"), 10)).resolves.toBe(false);
  });
});

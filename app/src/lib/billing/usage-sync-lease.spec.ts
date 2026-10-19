/** @jest-environment node */
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
import { getRedisConnection } from "@/lib/queue";
import { withUsageSyncLease } from "./usage-sync-lease";
const redis = { set: jest.fn(), eval: jest.fn() };
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); jest.mocked(getRedisConnection).mockResolvedValue(redis as never); redis.set.mockResolvedValue("OK"); redis.eval.mockResolvedValue(1); });
afterEach(() => jest.useRealTimers());
it("skips a held lease", async () => {
  redis.set.mockResolvedValue(null);
  const run = jest.fn();
  expect(await withUsageSyncLease(run)).toBeNull();
  expect(run).not.toHaveBeenCalled();
  expect(redis.eval).not.toHaveBeenCalled();
});
it("renews and releases only its own token", async () => {
  await withUsageSyncLease(async (assertOwned) => { await jest.advanceTimersByTimeAsync(20_000); assertOwned(); });
  const owner = redis.set.mock.calls[0][1];
  expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("get"), 1, "billing:usage-sync:lease", owner, "pexpire", "60000");
  expect(redis.eval).toHaveBeenLastCalledWith(expect.stringContaining("get"), 1, "billing:usage-sync:lease", owner, "del");
  expect(jest.getTimerCount()).toBe(0);
});
it("stops after loss of ownership and clears renewal", async () => {
  redis.eval.mockResolvedValue(0);
  await expect(withUsageSyncLease(async (assertOwned) => { await jest.advanceTimersByTimeAsync(20_000); assertOwned(); })).rejects.toThrow("lease lost");
  expect(jest.getTimerCount()).toBe(0);
});

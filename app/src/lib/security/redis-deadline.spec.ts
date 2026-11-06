/** @jest-environment node */
import { RedisUnavailableError, withRedisDeadline } from "./redis-deadline";

describe("withRedisDeadline", () => {
  afterEach(() => jest.useRealTimers());

  it("returns the result when Redis answers", async () => {
    await expect(withRedisDeadline({ status: "ready" }, async () => 7)).resolves.toBe(7);
  });

  it.each([[null], [{ status: "connecting" }], [{ status: "end" }]])("refuses at once when Redis is %j", async (redis) => {
    const call = jest.fn();
    await expect(withRedisDeadline(redis, call)).rejects.toBeInstanceOf(RedisUnavailableError);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects when the call never resolves", async () => {
    jest.useFakeTimers();
    const pending = withRedisDeadline({ status: "ready" }, () => new Promise<never>(() => {}));
    const assertion = expect(pending).rejects.toBeInstanceOf(RedisUnavailableError);
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});

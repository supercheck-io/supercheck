/** @jest-environment node */
const mockEval = jest.fn();
const mockConnection = jest.fn();
jest.mock("@/lib/queue", () => ({ getRedisConnection: () => mockConnection() }));

import { checkHeartbeatRateLimit, HEARTBEAT_IP_LIMIT_PER_MINUTE, HEARTBEAT_TOKEN_LIMIT_PER_MINUTE } from "./rate-limit";

beforeEach(() => {
  mockEval.mockReset();
  mockConnection.mockReset().mockResolvedValue({ eval: mockEval });
});

describe("checkHeartbeatRateLimit (B4)", () => {
  it("uses 10 per token and 1200 per IP hash, never the raw IP", async () => {
    mockEval.mockResolvedValue([1, 0]);
    await expect(checkHeartbeatRateLimit("h".repeat(64), "203.0.113.9")).resolves.toEqual({ allowed: true });
    const [, keyCount, tokenKey, ipKey, , , tokenLimit, ipLimit] = mockEval.mock.calls[0];
    expect(keyCount).toBe(2);
    expect(tokenKey).toBe(`supercheck:heartbeat:rl:token:${"h".repeat(64)}`);
    expect(ipKey).toMatch(/^supercheck:heartbeat:rl:ip:[0-9a-f]{64}$/);
    expect(ipKey).not.toContain("203.0.113.9");
    expect([tokenLimit, ipLimit]).toEqual([HEARTBEAT_TOKEN_LIMIT_PER_MINUTE, HEARTBEAT_IP_LIMIT_PER_MINUTE]);
    expect([tokenLimit, ipLimit]).toEqual([10, 1200]);
  });

  it("gives an unknown client IP its own per-token bucket instead of one shared bucket", async () => {
    mockEval.mockResolvedValue([1, 0]);
    await checkHeartbeatRateLimit("abc", null);
    expect(mockEval.mock.calls[0][3]).toBe("supercheck:heartbeat:rl:ip:none:abc");
  });

  it("refuses over the limit with a Retry-After from the oldest entry", async () => {
    const now = Date.now();
    mockEval.mockResolvedValue([0, String(now - 30_000)]);
    const result = await checkHeartbeatRateLimit("abc", "203.0.113.9");
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(result.allowed === false && result.retryAfterSeconds).toBeLessThanOrEqual(31);
  });

  it("answers at least one second", async () => {
    mockEval.mockResolvedValue([0, 0]);
    await expect(checkHeartbeatRateLimit("abc", null)).resolves.toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("allows when Redis is down (a dropped ping would raise a false alert)", async () => {
    mockConnection.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(checkHeartbeatRateLimit("abc", "203.0.113.9")).resolves.toEqual({ allowed: true });
    mockConnection.mockResolvedValue({ eval: jest.fn().mockRejectedValue(new Error("timeout")) });
    await expect(checkHeartbeatRateLimit("abc", "203.0.113.9")).resolves.toEqual({ allowed: true });
  });
});

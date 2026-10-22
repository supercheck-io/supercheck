/** @jest-environment node */
const mockLimit = jest.fn();
const mockIP = jest.fn();
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: (...args: unknown[]) => mockLimit(...args) },
}));
jest.mock("@/lib/session-security", () => ({ getClientIP: (...args: unknown[]) => mockIP(...args) }));
import { prepareMcpOAuthRequest } from "./request-policy";

const request = (path = "register") => new Request(`https://app.example.com/api/auth/oauth2/${path}`, {
  method: "POST",
  headers: { "x-forwarded-for": "203.0.113.66, 10.0.0.1", "cf-connecting-ip": "203.0.113.99" },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockIP.mockReturnValue("192.0.2.5");
  mockLimit.mockResolvedValue({ allowed: true });
});

it("gives Better Auth the resolved client address rather than an untrusted chain", async () => {
  const prepared = await prepareMcpOAuthRequest(request());
  expect(prepared).toBeInstanceOf(Request);
  expect(prepared.headers.get("x-forwarded-for")).toBe("192.0.2.5");
  expect(prepared.headers.has("cf-connecting-ip")).toBe(false);
  expect(mockLimit).toHaveBeenCalledWith(expect.any(String), { enabled: true, timeWindow: 60, maxRequests: 5 });
});

it("does not put unidentified callers in a shared bucket", async () => {
  mockIP.mockReturnValue("unknown");
  const prepared = await prepareMcpOAuthRequest(request());
  expect(prepared).toBeInstanceOf(Response);
  expect((prepared as Response).status).toBe(503);
  expect(mockLimit).not.toHaveBeenCalled();
});

it("rejects an exhausted shared limit before invoking the provider", async () => {
  mockLimit.mockResolvedValue({ allowed: false, retryAfter: 27 });
  const prepared = await prepareMcpOAuthRequest(request());
  expect((prepared as Response).status).toBe(429);
  expect(prepared.headers.get("retry-after")).toBe("27");
});

it("uses separate address and endpoint buckets with bounded token traffic", async () => {
  await prepareMcpOAuthRequest(request("token"));
  const first = mockLimit.mock.calls[0][0];
  mockIP.mockReturnValue("192.0.2.6");
  await prepareMcpOAuthRequest(request("token"));
  expect(mockLimit.mock.calls[1][0]).not.toBe(first);
  expect(mockLimit.mock.calls[0][1].maxRequests).toBe(60);
});

it("applies the shared client limit to token revocation", async () => {
  await prepareMcpOAuthRequest(request("revoke"));
  expect(mockLimit).toHaveBeenCalledWith(expect.any(String), { enabled: true, timeWindow: 60, maxRequests: 30 });
});

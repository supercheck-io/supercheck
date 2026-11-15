/** @jest-environment node */
const mockRecord = jest.fn();
const mockRelease = jest.fn(async () => {});
const mockLimit = jest.fn();
const mockWarn = jest.fn();
jest.mock("@/lib/heartbeat/ping", () => ({ recordHeartbeatPing: (...args: unknown[]) => mockRecord(...args) }));
jest.mock("@/lib/heartbeat/rate-limit", () => ({ checkHeartbeatRateLimit: (...args: unknown[]) => mockLimit(...args) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }) }));

import { GET, HEAD, POST } from "./route";
import { GET as ACTION_GET, POST as ACTION_POST } from "./[action]/route";
import { hashHeartbeatToken } from "@/lib/heartbeat/token";

const TOKEN = `hb_${"c".repeat(32)}`;
const url = (path = TOKEN) => `https://app.test/api/heartbeat/${path}`;
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) });
const actionCtx = (action: string, token = TOKEN) => ({ params: Promise.resolve({ token, action }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockLimit.mockResolvedValue({ allowed: true, release: mockRelease });
  mockRecord.mockResolvedValue(true);
});

describe("public heartbeat ping (B2-B5)", () => {
  it.each([["GET", GET], ["POST", POST]] as const)("%s records a ping and answers 200 OK, uncached", async (method, handler) => {
    const res = await handler(new Request(url(), { method, headers: { "user-agent": "cron/1" } }), ctx());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mockRecord).toHaveBeenCalledWith(hashHeartbeatToken(TOKEN), "ping", "cron/1");
  });

  it("HEAD records the ping and has no body", async () => {
    const res = await HEAD(new Request(url(), { method: "HEAD" }), ctx());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(mockRecord).toHaveBeenCalled();
  });

  it.each(["start", "fail"])("/%s records its own kind", async (action) => {
    const res = await ACTION_POST(new Request(url(`${TOKEN}/${action}`), { method: "POST" }), actionCtx(action));
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(hashHeartbeatToken(TOKEN), action, null);
  });

  it("an unknown action is 404 and records nothing", async () => {
    const res = await ACTION_GET(new Request(url(`${TOKEN}/other`)), actionCtx("other"));
    expect(res.status).toBe(404);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a malformed token answers the same 200 OK without touching Redis or the database", async () => {
    const res = await GET(new Request(url("hb_nope")), ctx("hb_nope"));
    expect([res.status, await res.text()]).toEqual([200, "OK"]);
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a chat link preview answers the same 200 OK and records nothing", async () => {
    for (const ua of ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Mozilla/5.0 SkypeUriPreview Preview/0.5", "Discordbot/2.0"]) {
      const res = await GET(new Request(url(), { headers: { "user-agent": ua } }), ctx());
      expect([res.status, await res.text()]).toEqual([200, "OK"]);
    }
    expect(mockRecord).not.toHaveBeenCalled();
    // A POST from the same sender (Slack workflow) is a real ping.
    await POST(new Request(url(), { method: "POST", headers: { "user-agent": "Slackbot 1.0 (+https://api.slack.com/robots)" } }), ctx());
    expect(mockRecord).toHaveBeenCalledTimes(1);
    mockRecord.mockClear();
    const real = await GET(new Request(url(), { headers: { "user-agent": "curl/8.5.0" } }), ctx());
    expect(real.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("an unknown token (no row matched) answers the same 200 OK", async () => {
    mockRecord.mockResolvedValue(false);
    const res = await GET(new Request(url()), ctx());
    expect([res.status, await res.text()]).toEqual([200, "OK"]);
  });

  it("rejects a body over 10 000 bytes with 413 before anything else", async () => {
    const res = await POST(new Request(url(), { method: "POST", headers: { "content-length": "10001" }, body: "x" }), ctx());
    expect(res.status).toBe(413);
    expect(mockLimit).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
    const ok = await POST(new Request(url(), { method: "POST", headers: { "content-length": "10000" }, body: "x" }), ctx());
    expect(ok.status).toBe(200);
  });

  it("answers 429 with Retry-After over the rate limit and records nothing", async () => {
    mockLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const res = await GET(new Request(url()), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a database failure answers 503 and logs only the token hash prefix", async () => {
    // Drizzle query errors embed the params (full hash) in the message; it must not be logged.
    mockRecord.mockRejectedValue(new Error(`Failed query: UPDATE monitors\nparams: ${hashHeartbeatToken(TOKEN)},curl/8`));
    const res = await GET(new Request(url()), ctx());
    expect(res.status).toBe(503);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(3);
    const logged = JSON.stringify(mockWarn.mock.calls);
    expect(logged).toContain(hashHeartbeatToken(TOKEN).slice(0, 8));
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(hashHeartbeatToken(TOKEN));
    expect(await res.text()).not.toContain(TOKEN);
  });
});

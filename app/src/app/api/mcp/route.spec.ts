/** @jest-environment node */
const requireMcpAuth = jest.fn();
const resolveMcpCallContext = jest.fn();
const isMcpServerEnabled = jest.fn();
const checkAndIncrement = jest.fn();

jest.mock("@better-auth/mcp", () => ({ requireMcpAuth: (...a: unknown[]) => requireMcpAuth(...a) }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/lib/mcp/config", () => ({
  MCP_READ_SCOPE: "mcp:read",
  getMcpResourceUrl: () => "https://app.example.com/api/mcp",
  isMcpServerEnabled: () => isMcpServerEnabled(),
}));
jest.mock("@/lib/mcp/context", () => {
  class McpAccessDeniedError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  }
  return { McpAccessDeniedError, resolveMcpCallContext: (...a: unknown[]) => resolveMcpCallContext(...a) };
});
jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: { checkAndIncrement: (...a: unknown[]) => checkAndIncrement(...a) },
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/mcp/tools", () => ({ registerMcpTools: jest.fn() }));

import { DELETE, GET, POST } from "./route";

const init = {
  ctx: { userId: "u", clientId: "c", organizationId: "o", projectId: "p", role: "project_viewer" },
};
const rpc = (method: string) =>
  new Request("https://app.example.com/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } : {} }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  isMcpServerEnabled.mockReturnValue(true);
  checkAndIncrement.mockResolvedValue({ allowed: true, remaining: 10, limit: 300, resetAt: new Date() });
  // Run the wrapped handler with fixed claims, like a valid token would.
  requireMcpAuth.mockImplementation((_auth, handler) => (req: Request) => handler(req, { sub: "u", azp: "c" }));
});

describe("/api/mcp", () => {
  it.each([
    { host: "attacker.example", origin: undefined },
    { host: "app.example.com", origin: "https://attacker.example" },
    { host: "app.example.com", origin: "not a URL" },
    { host: "app.example.com/evil", origin: undefined },
  ])("rejects untrusted Host/Origin before authentication: %j", async ({ host, origin }) => {
    const headers = new Headers(rpc("initialize").headers);
    headers.set("host", host);
    if (origin) headers.set("origin", origin);
    const res = await POST(new Request(rpc("initialize"), { headers }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { data: { code: "invalid_request_origin" } } });
    expect(requireMcpAuth).not.toHaveBeenCalled();
  });

  it("allows the configured browser origin and valid proxy Host", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const headers = new Headers(rpc("initialize").headers);
    headers.set("host", "app.example.com"); headers.set("origin", "https://app.example.com");
    expect((await POST(new Request(rpc("initialize"), { headers }))).status).toBe(200);
  });

  it("accepts an internal proxy URL only with the validated public Host", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const headers = new Headers(rpc("initialize").headers); headers.set("host", "app.example.com");
    const req = new Request("http://app:3000/api/mcp", { method:"POST", headers, body:await rpc("initialize").text() });
    expect((await POST(req)).status).toBe(200);
  });

  it("keeps Bearer challenges while shaping auth refusals as JSON-RPC", async () => {
    requireMcpAuth.mockImplementation(() => () => Response.json({ error: "unauthorized" }, {
      status: 401, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"' },
    }));
    const res = await POST(rpc("initialize"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { data: { code: "unauthorized" } } });
  });

  it("does not leak an auth or limiter infrastructure failure", async () => {
    requireMcpAuth.mockImplementation(() => () => { throw new Error("secret internal database query"); });
    const res = await POST(rpc("initialize"));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("database query");
  });

  it("returns a parse error for invalid JSON instead of rereading the consumed body", async () => {
    const res = await POST(new Request(rpc("initialize"), { body: "{invalid" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
    expect(resolveMcpCallContext).not.toHaveBeenCalled();
  });

  it("documents the Streamable HTTP Accept requirement even with JSON responses", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const headers = new Headers(rpc("initialize").headers); headers.set("accept", "application/json");
    const res = await POST(new Request(rpc("initialize"), { headers }));
    expect(res.status).toBe(406);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: expect.any(Object) });
  });

  it("is 404 when the flag is off", async () => {
    isMcpServerEnabled.mockReturnValue(false);
    expect((await POST(rpc("initialize"))).status).toBe(404);
    expect((await GET()).status).toBe(404);
    expect(requireMcpAuth).not.toHaveBeenCalled();
  });

  it("answers GET and DELETE with 405", async () => {
    expect((await GET()).status).toBe(405);
    expect((await DELETE()).status).toBe(405);
  });

  it("requires mcp:read and the MCP resource audience via the auth wrapper", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    await POST(rpc("initialize"));
    expect(requireMcpAuth.mock.calls[0][2]).toMatchObject({
      resource: "https://app.example.com/api/mcp",
      requiredScopes: ["mcp:read"],
    });
  });

  it("returns 403 when consent, ban or membership checks fail", async () => {
    const { McpAccessDeniedError } = jest.requireMock("@/lib/mcp/context");
    resolveMcpCallContext.mockRejectedValue(new McpAccessDeniedError("consent_revoked"));
    const res = await POST(rpc("initialize"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32000, data: { code: "access_denied" } } });
  });

  it("rejects oversized bodies", async () => {
    const req = rpc("initialize");
    const big = new Request(req, { headers: { ...Object.fromEntries(req.headers), "content-length": String(2 * 1024 * 1024) } });
    expect((await POST(big)).status).toBe(413);
  });

  it("serves initialize over JSON for a valid caller", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const res = await POST(rpc("initialize"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { serverInfo: { name: "supercheck" } } });
  });

  describe("throttling", () => {
    const batch = (size: number) =>
      new Request("https://app.example.com/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(Array.from({ length: size }, (_, id) => ({ jsonrpc: "2.0", id, method: "ping" }))),
      });

    it("counts every message of a batch against the token's quota", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      await POST(batch(5));
      // One atomic call per bucket carrying the whole batch: this app, then the user's total across apps.
      expect(checkAndIncrement).toHaveBeenCalledTimes(2);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(1, "mcp:call:u:c", expect.objectContaining({ timeWindow: 60, maxRequests: 300 }), 5);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(2, "mcp:user:u", expect.objectContaining({ timeWindow: 60, maxRequests: 600 }), 5);
    });

    it("refuses a chunked body over the cap even without a Content-Length", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      const chunk = new TextEncoder().encode("x".repeat(512 * 1024));
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      });
      const req = new Request("https://app.example.com/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: stream,
        duplex: "half",
      } as RequestInit);
      expect((await POST(req)).status).toBe(413);
      expect(checkAndIncrement).not.toHaveBeenCalled();
    });

    it("rejects an oversized batch before doing any work", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      const res = await POST(batch(100));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { data: { code: "batch_too_large" } } });
      expect(checkAndIncrement).not.toHaveBeenCalled();
    });

    it("spends no database work on a request the quota refuses", async () => {
      checkAndIncrement.mockResolvedValue({ allowed: false, remaining: 0, limit: 300, resetAt: new Date(), retryAfter: 5 });
      const res = await POST(rpc("initialize"));
      expect(res.status).toBe(429);
      expect(resolveMcpCallContext).not.toHaveBeenCalled();
    });

    it("frees the slot when access is denied", async () => {
      const { McpAccessDeniedError } = jest.requireMock("@/lib/mcp/context");
      resolveMcpCallContext.mockRejectedValue(new McpAccessDeniedError("consent_revoked"));
      for (let i = 0; i < 6; i += 1) expect((await POST(rpc("initialize"))).status).toBe(403);
    });

    it("answers 429 with Retry-After once the quota is spent", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      checkAndIncrement.mockResolvedValue({ allowed: false, remaining: 0, limit: 300, resetAt: new Date(), retryAfter: 17 });
      const res = await POST(rpc("initialize"));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("17");
      expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { data: { code: "rate_limited" } } });
    });

    it("answers 503, not 429, when the rate limiter itself is down", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      checkAndIncrement.mockResolvedValue({ allowed: false, remaining: 0, limit: 300, resetAt: new Date(), retryAfter: 60, unavailable: true });
      const res = await POST(rpc("initialize"));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toMatchObject({ error: { data: { code: "rate_limiter_unavailable" } } });
      expect(resolveMcpCallContext).not.toHaveBeenCalled();
    });

    it("caps concurrent requests per token and frees the slot afterwards", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      checkAndIncrement.mockImplementation(async () => {
        await gate;
        return { allowed: true, remaining: 10, limit: 300, resetAt: new Date() };
      });
      const running = Array.from({ length: 4 }, () => POST(rpc("initialize")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const refused = await POST(rpc("initialize"));
      expect(refused.status).toBe(429);
      expect(await refused.json()).toMatchObject({ error: { data: { code: "too_many_concurrent_requests" } } });
      release();
      expect((await Promise.all(running)).map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect((await POST(rpc("initialize"))).status).toBe(200);
    });
  });
});

/** @jest-environment node */
const requireMcpAuth = jest.fn();
const resolveMcpCallContext = jest.fn();
const isMcpServerEnabled = jest.fn();
const checkAndIncrement = jest.fn();
const getMcpAllowedOrigins = jest.fn();

jest.mock("@better-auth/mcp", () => ({ requireMcpAuth: (...a: unknown[]) => requireMcpAuth(...a) }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/lib/mcp/config", () => ({
  MCP_READ_SCOPE: "mcp:read",
  getMcpResourceUrl: () => "https://app.example.com/api/mcp",
  isMcpServerEnabled: () => isMcpServerEnabled(),
  getMcpAllowedOrigins: () => getMcpAllowedOrigins(),
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
const mockEvents: string[] = [];
jest.mock("@/lib/mcp/call-limits", () => {
  const actual = jest.requireActual("@/lib/mcp/call-limits");
  return {
    ...actual,
    readMcpBody: (...a: unknown[]) => {
      mockEvents.push("read");
      return actual.readMcpBody(...a);
    },
  };
});
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/mcp/tools", () => ({ registerMcpTools: jest.fn() }));

import { DELETE, GET, POST } from "./route";
import { MCP_BODY_READ_TIMEOUT_MS } from "@/lib/mcp/call-limits";

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
  mockEvents.length = 0;
  isMcpServerEnabled.mockReturnValue(true);
  getMcpAllowedOrigins.mockReturnValue([]);
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

  it("allows an origin listed for MCP but not one that is only in the general CORS list", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    getMcpAllowedOrigins.mockReturnValue(["https://inspector.example.com"]);
    const call = (origin: string) => {
      const headers = new Headers(rpc("initialize").headers);
      headers.set("host", "app.example.com"); headers.set("origin", origin);
      return POST(new Request(rpc("initialize"), { headers }));
    };
    expect((await call("https://inspector.example.com")).status).toBe(200);
    // A sibling site on the default CORS allow-list is not named for MCP, so it is refused.
    expect((await call("https://docs.supercheck.io")).status).toBe(403);
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

  it("times out a stalled body upload with 408 and releases the permit", async () => {
    jest.useFakeTimers();
    try {
      const stalled = () =>
        new Request("https://app.example.com/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("{")) }),
          duplex: "half",
        } as RequestInit);
      // Fill every per-app slot; each must free its permit on timeout or the next call is refused with 429.
      const pending = Array.from({ length: 4 }, () => POST(stalled()));
      await jest.advanceTimersByTimeAsync(MCP_BODY_READ_TIMEOUT_MS);
      for (const res of await Promise.all(pending)) {
        expect(res.status).toBe(408);
        expect(await res.json()).toMatchObject({ error: { data: { code: "request_timeout" } } });
      }
    } finally {
      jest.useRealTimers();
    }
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    expect((await POST(rpc("initialize"))).status).toBe(200);
  });

  it("serves initialize over JSON for a valid caller", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const res = await POST(rpc("initialize"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { serverInfo: { name: "supercheck" } } });
  });

  it.each([{}, { protocolVersion: 123, capabilities: {}, clientInfo: { name: "private input", version: "1" } }])(
    "returns sanitized invalid params for malformed initialize: %j", async (params) => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      const res = await POST(new Request(rpc("initialize"), {
        body: JSON.stringify({ jsonrpc: "2.0", id: "init-1", method: "initialize", params }),
      }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        jsonrpc: "2.0", id: "init-1",
        error: { code: -32602, message: "Invalid initialize params", data: { code: "invalid_params" } },
      });
      expect(resolveMcpCallContext).not.toHaveBeenCalled();
    },
  );

  it("sanitizes invalid initialize params in a single-message batch", async () => {
    resolveMcpCallContext.mockResolvedValue(init.ctx);
    const res = await POST(new Request(rpc("initialize"), {
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0", id: 1,
      error: { code: -32602, message: "Invalid initialize params", data: { code: "invalid_params" } },
    });
    expect(resolveMcpCallContext).not.toHaveBeenCalled();
  });

  it("rejects a batch combining initialization with other messages without SDK details", async () => {
    const res = await POST(new Request(rpc("initialize"), {
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
      ]),
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      jsonrpc: "2.0", id: null,
      error: { code: -32600, message: "Initialize must be sent as a single request", data: { code: "invalid_request" } },
    });
    expect(resolveMcpCallContext).not.toHaveBeenCalled();
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
      // One message is charged before the body is read, the remaining four once it is parsed; each charge is
      // one atomic call per bucket: this app, then the user's total across apps.
      expect(checkAndIncrement).toHaveBeenCalledTimes(4);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(1, "mcp:call:u:c", expect.objectContaining({ timeWindow: 60, maxRequests: 300 }), 1);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(2, "mcp:user:u", expect.objectContaining({ timeWindow: 60, maxRequests: 600 }), 1);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(3, "mcp:call:u:c", expect.objectContaining({ timeWindow: 60, maxRequests: 300 }), 4);
      expect(checkAndIncrement).toHaveBeenNthCalledWith(4, "mcp:user:u", expect.objectContaining({ timeWindow: 60, maxRequests: 600 }), 4);
    });

    it("takes the slot and charges one message before the body is read", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      checkAndIncrement.mockImplementation(async () => {
        mockEvents.push("charge");
        return { allowed: true, remaining: 10, limit: 300, resetAt: new Date() };
      });
      await POST(batch(1));
      expect(mockEvents).toEqual(["charge", "charge", "read"]);
    });

    it("does not read the body of a caller the quota refuses", async () => {
      checkAndIncrement.mockResolvedValue({ allowed: false, remaining: 0, limit: 300, resetAt: new Date(), retryAfter: 5 });
      expect((await POST(batch(5))).status).toBe(429);
      expect(mockEvents).not.toContain("read");
    });

    it("charges a single message for a body that is not JSON", async () => {
      const res = await POST(new Request(rpc("initialize"), { body: "{invalid" }));
      expect(res.status).toBe(400);
      expect(checkAndIncrement).toHaveBeenCalledTimes(2);
    });

    it("refuses a batch the quota cannot cover after parsing and frees the slot", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      checkAndIncrement
        .mockResolvedValueOnce({ allowed: true, remaining: 10, limit: 300, resetAt: new Date() })
        .mockResolvedValueOnce({ allowed: true, remaining: 10, limit: 600, resetAt: new Date() })
        .mockResolvedValueOnce({ allowed: false, remaining: 0, limit: 300, resetAt: new Date(), retryAfter: 9 });
      const res = await POST(batch(5));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("9");
      expect(resolveMcpCallContext).not.toHaveBeenCalled();
      // The slot was released: a full set of concurrent calls still fits afterwards.
      checkAndIncrement.mockResolvedValue({ allowed: true, remaining: 10, limit: 300, resetAt: new Date() });
      for (let i = 0; i < 6; i += 1) expect((await POST(rpc("initialize"))).status).toBe(200);
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
      // Only the up-front single message was charged; the body never reached the batch charge.
      expect(checkAndIncrement).toHaveBeenCalledTimes(2);
    });

    it("rejects an oversized batch before doing any work", async () => {
      resolveMcpCallContext.mockResolvedValue(init.ctx);
      const res = await POST(batch(100));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ jsonrpc: "2.0", error: { data: { code: "batch_too_large" } } });
      expect(checkAndIncrement).toHaveBeenCalledTimes(2);
      expect(resolveMcpCallContext).not.toHaveBeenCalled();
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

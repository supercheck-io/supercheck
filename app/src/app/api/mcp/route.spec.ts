/** @jest-environment node */
const requireMcpAuth = jest.fn();
const resolveMcpCallContext = jest.fn();
const isMcpServerEnabled = jest.fn();

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
  // Run the wrapped handler with fixed claims, like a valid token would.
  requireMcpAuth.mockImplementation((_auth, handler) => (req: Request) => handler(req, { sub: "u" }));
});

describe("/api/mcp", () => {
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
    expect(await res.json()).toEqual({ error: "access_denied" });
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
});

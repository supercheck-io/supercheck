/** @jest-environment node */
import { NextRequest } from "next/server";

const mockGetSession = jest.fn();
const mockConsent = jest.fn();
const mockImpersonated = jest.fn();
const mockAssert = jest.fn();
const mockRunWith = jest.fn();
const mockList = jest.fn();
const mockRevoke = jest.fn();
const mockAudit = jest.fn();
let mockEnabled = true;

jest.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session=1" }) }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } } }));
jest.mock("@/lib/mcp/auth-api", () => ({ mcpAuthApi: () => ({ oauth2Consent: (...a: unknown[]) => mockConsent(...a) }) }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => mockAudit(...a) }));
jest.mock("@/lib/logger/pino-config", () => ({ createLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("@/lib/mcp/config", () => ({ isMcpServerEnabled: () => mockEnabled }));
jest.mock("@/lib/mcp/connect-project", () => {
  class McpProjectAccessError extends Error {}
  return {
    McpProjectAccessError,
    assertCanConnectProject: (...a: unknown[]) => mockAssert(...a),
    runWithConsentProject: (...a: unknown[]) => mockRunWith(...a),
    listConnectableProjects: (...a: unknown[]) => mockList(...a),
  };
});
jest.mock("@/lib/mcp/connections", () => {
  class McpConnectionNotFoundError extends Error {}
  return {
    McpConnectionNotFoundError,
    listMcpConnections: (...a: unknown[]) => mockList(...a),
    revokeMcpConnection: (...a: unknown[]) => mockRevoke(...a),
  };
});

import { POST as consentPost } from "./consent/route";
import { GET as listGet } from "./connections/route";
import { DELETE as connectionDelete } from "./connections/[id]/route";
import { McpProjectAccessError } from "@/lib/mcp/connect-project";
import { McpConnectionNotFoundError } from "@/lib/mcp/connections";

const ORIGIN = "https://app.example.com";
const PROJECT = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const CONSENT_ID = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const session = { user: { id: "user-1", email: "a@example.com" }, session: { id: "session-1" } };

function consentRequest(body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new NextRequest(`${ORIGIN}/api/oauth/mcp/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const approve = {
  accept: true,
  projectId: PROJECT,
  oauth_query: "client_id=c&sig=s&exp=1&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
  mockGetSession.mockResolvedValue(session);
  mockImpersonated.mockResolvedValue(false);
  mockAssert.mockResolvedValue(undefined);
  mockRunWith.mockImplementation(async (_selection: unknown, fn: () => Promise<unknown>) => fn());
  mockConsent.mockResolvedValue({ url: "http://127.0.0.1:8765/callback?code=abc&state=xyz" });
  mockRevoke.mockResolvedValue(undefined);
});

describe("POST /api/oauth/mcp/consent", () => {
  it("records the chosen project, then asks Better Auth to issue the code, and returns the redirect", async () => {
    const response = await consentPost(consentRequest(approve));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "http://127.0.0.1:8765/callback?code=abc&state=xyz" });
    expect(mockAssert).toHaveBeenCalledWith("user-1", PROJECT);
    // The choice reaches Better Auth through this approval's own context, not shared storage.
    expect(mockRunWith).toHaveBeenCalledWith({ userId: "user-1", projectId: PROJECT }, expect.any(Function));
    expect(mockConsent).toHaveBeenCalledWith(expect.objectContaining({ body: { accept: true, oauth_query: approve.oauth_query } }));
    // The choice must be recorded before consent is granted.
    expect(mockAssert.mock.invocationCallOrder[0]).toBeLessThan(mockConsent.mock.invocationCallOrder[0]);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "mcp_connection_approved", userId: "user-1", success: true }));
  });

  it("denies without selecting a project", async () => {
    mockConsent.mockResolvedValue({ url: "http://127.0.0.1:8765/callback?error=access_denied" });
    const response = await consentPost(consentRequest({ accept: false, oauth_query: approve.oauth_query }));
    expect(response.status).toBe(200);
    expect(mockAssert).not.toHaveBeenCalled();
    expect(mockConsent).toHaveBeenCalledWith(expect.objectContaining({ body: { accept: false, oauth_query: approve.oauth_query } }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "mcp_connection_denied" }));
    // A denial needs no project and runs outside any approval context.
    expect(mockRunWith).not.toHaveBeenCalled();
  });

  it("does not exist when the MCP server is disabled", async () => {
    mockEnabled = false;
    expect((await consentPost(consentRequest(approve))).status).toBe(404);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("refuses cross-origin requests", async () => {
    expect((await consentPost(consentRequest(approve, { origin: "https://evil.example" }))).status).toBe(403);
    expect(mockAssert).not.toHaveBeenCalled();
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await consentPost(consentRequest(approve))).status).toBe(401);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("refuses while impersonating, so a durable connection never belongs to the impersonated user", async () => {
    mockImpersonated.mockResolvedValue(true);
    const response = await consentPost(consentRequest(approve));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "impersonation_not_allowed" });
    expect(mockAssert).not.toHaveBeenCalled();
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a non-boolean accept", { accept: "yes", oauth_query: "q=1" }],
    ["a missing oauth_query", { accept: true, projectId: PROJECT }],
    ["an oversized oauth_query", { accept: true, projectId: PROJECT, oauth_query: "x".repeat(9000) }],
    ["a non-UUID project", { accept: true, projectId: "not-a-uuid", oauth_query: "q=1" }],
  ])("rejects %s", async (_name, body) => {
    expect((await consentPost(consentRequest(body))).status).toBe(400);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("requires a project to approve", async () => {
    const response = await consentPost(consentRequest({ accept: true, oauth_query: approve.oauth_query }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "project_required" });
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("refuses a project the user cannot connect and issues nothing", async () => {
    mockAssert.mockRejectedValue(new McpProjectAccessError());
    const response = await consentPost(consentRequest(approve));
    expect(response.status).toBe(403);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("refuses an unsafe redirect target even when Better Auth returns one", async () => {
    mockConsent.mockResolvedValue({ url: "javascript:alert(1)" });
    expect((await consentPost(consentRequest(approve))).status).toBe(502);
  });

  it("reports an expired or replayed request without leaking details", async () => {
    mockConsent.mockRejectedValue(new Error("invalid_signature: secret internals"));
    const response = await consentPost(consentRequest(approve));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("secret internals");
  });

  it("rejects a valid JSON body over the size cap", async () => {
    // Within every field's own limit, so only the body cap can reject it.
    const padded = { ...approve, padding: "x".repeat(20 * 1024) };
    const response = await consentPost(consentRequest(padded));
    expect(response.status).toBe(400);
    expect(mockAssert).not.toHaveBeenCalled();
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("refuses an unusable redirect_uri before recording any consent", async () => {
    for (const redirect of ["javascript:alert(1)", "data:text/html,x", "", "not a url"]) {
      mockAssert.mockClear();
      mockConsent.mockClear();
      const query = new URLSearchParams({ client_id: "c", sig: "s", exp: "1", redirect_uri: redirect }).toString();
      const response = await consentPost(consentRequest({ ...approve, oauth_query: query }));
      expect(response.status).toBe(400);
      expect(mockAssert).not.toHaveBeenCalled();
      expect(mockConsent).not.toHaveBeenCalled();
    }
  });
});

describe("GET /api/oauth/mcp/connections", () => {
  it("returns the signed-in user's connections, uncached", async () => {
    mockList.mockResolvedValue([{ id: CONSENT_ID, clientName: "Agent" }]);
    const response = await listGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ connections: [{ id: CONSENT_ID, clientName: "Agent" }] });
    expect(mockList).toHaveBeenCalledWith("user-1");
  });

  it("requires a session and the feature flag", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await listGet()).status).toBe(401);
    mockEnabled = false;
    expect((await listGet()).status).toBe(404);
  });
});

describe("DELETE /api/oauth/mcp/connections/:id", () => {
  const call = (id: string, headers: Record<string, string> = { origin: ORIGIN }) =>
    connectionDelete(
      new NextRequest(`${ORIGIN}/api/oauth/mcp/connections/${id}`, { method: "DELETE", headers }),
      { params: Promise.resolve({ id }) },
    );

  it("revokes only the signed-in user's connection and audits it", async () => {
    const response = await call(CONSENT_ID);
    expect(response.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith({ userId: "user-1", consentId: CONSENT_ID });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "mcp_connection_revoked", resourceId: CONSENT_ID }));
  });

  it("reports a missing or foreign connection as not found", async () => {
    mockRevoke.mockRejectedValue(new McpConnectionNotFoundError());
    expect((await call(CONSENT_ID)).status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before touching the database", async () => {
    expect((await call("not-a-uuid")).status).toBe(404);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("refuses cross-origin, anonymous and impersonated requests", async () => {
    expect((await call(CONSENT_ID, { origin: "https://evil.example" })).status).toBe(403);
    mockGetSession.mockResolvedValue(null);
    expect((await call(CONSENT_ID)).status).toBe(401);
    mockGetSession.mockResolvedValue(session);
    mockImpersonated.mockResolvedValue(true);
    expect((await call(CONSENT_ID)).status).toBe(403);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("does not exist when the MCP server is disabled", async () => {
    mockEnabled = false;
    expect((await call(CONSENT_ID)).status).toBe(404);
  });
});

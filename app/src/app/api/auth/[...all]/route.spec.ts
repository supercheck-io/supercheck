/** @jest-environment node */
jest.mock("@/utils/auth", () => ({ auth: {} }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: (...args: unknown[]) => mockGet(...args), POST: (...args: unknown[]) => mockPost(...args) }) }));
import { GET, POST } from "./route";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { createMcpAuthPlugins } from "@/lib/mcp/auth-plugins";

describe("generic authentication organization safeguards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(new Response("ok"));
    mockPost.mockResolvedValue(new Response("ok"));
  });
  // Enumerate the installed plugin, so upgrades cannot silently add a write bypass.
  const pluginRoutes = Object.values(organization().endpoints).filter(endpoint => endpoint.path);
  it.each(pluginRoutes.map(endpoint => [endpoint.path]))("enforces app policy for installed route %s", async path => {
    for (const [method, handler] of [["GET", GET], ["POST", POST]] as const) {
      const response = await handler(new Request(`https://app.supercheck.io/api/auth${path}/`, { method }));
      const allowed = path === "/organization/list" && method === "GET";
      expect(response.status).toBe(allowed ? 200 : 403);
    }
    expect(mockPost).not.toHaveBeenCalled();
  });
  it.each(["future-write", "%69nvite-member", "update/member", "list"])("denies unknown, encoded and non-read organization requests: %s", async endpoint => {
    expect((await POST(new Request(`https://app.supercheck.io/api/auth/organization/${endpoint}`, { method: "POST" }))).status).toBe(403);
    expect(mockPost).not.toHaveBeenCalled();
  });
  // The api-key plugin can mint keys with any prefix, no RBAC and no audit; only the app's own routes may create them.
  const apiKeyRoutes = Object.values(apiKey().endpoints).filter((endpoint) => (endpoint as { path?: string }).path).map((endpoint) => (endpoint as { path: string }).path);
  it("covers the installed api-key plugin (guards against an empty enumeration)", () => {
    expect(apiKeyRoutes).toEqual(expect.arrayContaining(["/api-key/create"]));
  });
  it.each(apiKeyRoutes.map((path) => [path]))("denies installed api-key route %s for every method", async (path) => {
    for (const [method, handler] of [["GET", GET], ["POST", POST]] as const) {
      expect((await handler(new Request(`https://app.supercheck.io/api/auth${path}`, { method }))).status).toBe(403);
    }
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });
  it.each(["/api-key/create", "/api-key/%63reate", "/api-key/create/", "/api-key", "/api-key/anything-new"])("denies encoded, trailing-slash and unknown api-key paths: %s", async (path) => {
    expect((await POST(new Request(`https://app.supercheck.io/api/auth${path}`, { method: "POST" }))).status).toBe(403);
    expect(mockPost).not.toHaveBeenCalled();
  });
  it("does not block unrelated routes that merely contain the text", async () => {
    expect((await POST(new Request("https://app.supercheck.io/api/auth/verify-key-not-a-plugin-route", { method: "POST" }))).status).toBe(200);
  });
  it.each(["sign-in/email", "sign-up/email", "sign-out", "get-session"])("preserves %s", async endpoint => {
    const request = new Request(`https://app.supercheck.io/api/auth/${endpoint}`);
    expect((await GET(request)).status).toBe(200);
    expect((await POST(request)).status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith(request);
    expect(mockPost).toHaveBeenCalledWith(request);
  });

  // The guard only applies while the MCP server is on; with it off the plugins are not registered.
  const originalFlag = process.env.MCP_SERVER_ENABLED;
  beforeAll(() => { process.env.MCP_SERVER_ENABLED = "true"; });
  afterAll(() => { if (originalFlag === undefined) delete process.env.MCP_SERVER_ENABLED; else process.env.MCP_SERVER_ENABLED = originalFlag; });

  // The OAuth provider and JWT plugins add dozens of routes. Only what MCP clients need is reachable over
  // HTTP; enumerating the installed plugins means a new route in a future release is denied by default.
  type Endpoint = { path?: string; options?: { method?: string | string[] } };
  const mcpRoutes = createMcpAuthPlugins({
    resource: "https://app.example.com/api/mcp",
    dynamicRegistration: true,
    resolveProjectReference: async () => undefined,
  }).flatMap((plugin) =>
    Object.values(((plugin as { endpoints?: unknown }).endpoints ?? {}) as Record<string, Endpoint>)
      .filter((endpoint) => endpoint.path)
      .flatMap((endpoint) =>
        [endpoint.options?.method ?? "GET"].flat().filter((m) => m !== "*").map((method) => [method, endpoint.path as string] as const),
      ),
  );
  // Reachable over HTTP: the OAuth flow itself, plus discovery documents and the signing keys.
  const reachable = new Set([
    "GET /oauth2/authorize", "POST /oauth2/authorize", "POST /oauth2/token", "POST /oauth2/register",
    "POST /oauth2/revoke", "GET /jwks", "GET /.well-known/oauth-authorization-server",
    "GET /.well-known/openid-configuration", "GET /.well-known/oauth-protected-resource",
  ]);
  it("covers the installed OAuth and JWT plugins (guards against an empty enumeration)", () => {
    expect(mcpRoutes.length).toBeGreaterThan(25);
    expect(mcpRoutes).toEqual(expect.arrayContaining([["POST", "/oauth2/token"], ["POST", "/oauth2/consent"], ["GET", "/token"]]));
  });
  it.each(mcpRoutes.map(([method, path]) => [method, path]))("%s %s is exposed only if an MCP client needs it", async (method, path) => {
    const url = path.replace(/:[a-z_]+/g, "x");
    const handler = method === "GET" ? GET : POST;
    const response = await handler(new Request(`https://app.supercheck.io/api/auth${url}`, { method }));
    expect(response.status).toBe(reachable.has(`${method} ${path}`) ? 200 : 403);
  });
  it.each(["/oauth2/%64elete-consent", "/oauth2/delete-consent/", "/oauth2/anything-new", "/admin/oauth2/anything-new", "/oauth2"])("denies encoded, trailing-slash and unknown OAuth paths: %s", async (path) => {
    expect((await POST(new Request(`https://app.supercheck.io/api/auth${path}`, { method: "POST" }))).status).toBe(403);
    expect((await GET(new Request(`https://app.supercheck.io/api/auth${path}`))).status).toBe(403);
  });
  it("does not allow a method the endpoint was not allowlisted for", async () => {
    expect((await GET(new Request("https://app.supercheck.io/api/auth/oauth2/token"))).status).toBe(403);
    expect((await POST(new Request("https://app.supercheck.io/api/auth/oauth2/register", { method: "POST" }))).status).toBe(200);
  });

  it("denies sub-routes of the session-JWT endpoint, not just its exact path", async () => {
    for (const path of ["/token", "/token/refresh", "/token/anything-new"]) {
      expect((await GET(new Request(`https://app.supercheck.io/api/auth${path}`))).status).toBe(403);
    }
  });

  it("leaves the OAuth paths to Better Auth, which answers 404, while the MCP server is off", async () => {
    process.env.MCP_SERVER_ENABLED = "false";
    try {
      mockPost.mockClear();
      expect((await POST(new Request("https://app.supercheck.io/api/auth/oauth2/create-client", { method: "POST" }))).status).toBe(200);
      expect(mockPost).toHaveBeenCalledTimes(1);
    } finally {
      process.env.MCP_SERVER_ENABLED = "true";
    }
  });

  it("advertises only reachable endpoints in Better Auth's own metadata document", async () => {
    mockGet.mockResolvedValue(
      Response.json({
        issuer: "https://app.supercheck.io/api/auth",
        token_endpoint: "https://app.supercheck.io/api/auth/oauth2/token",
        introspection_endpoint: "https://app.supercheck.io/api/auth/oauth2/introspect",
        introspection_endpoint_auth_methods_supported: ["private_key_jwt"],
      }),
    );
    const body = await (await GET(new Request("https://app.supercheck.io/api/auth/.well-known/oauth-authorization-server"))).json();
    expect(body.token_endpoint).toBeDefined();
    expect(body).not.toHaveProperty("introspection_endpoint");
    expect(body).not.toHaveProperty("introspection_endpoint_auth_methods_supported");
  });
});

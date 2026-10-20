/** @jest-environment node */
jest.mock("@/utils/auth", () => ({ auth: {} }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: (...args: unknown[]) => mockGet(...args), POST: (...args: unknown[]) => mockPost(...args) }) }));
import { GET, POST } from "./route";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

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
});

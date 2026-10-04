/** @jest-environment node */
jest.mock("@/utils/auth", () => ({ auth: {} }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: (...args: unknown[]) => mockGet(...args), POST: (...args: unknown[]) => mockPost(...args) }) }));
import { GET, POST } from "./route";
import { organization } from "better-auth/plugins";

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
  it.each(["sign-in/email", "sign-up/email", "sign-out", "get-session"])("preserves %s", async endpoint => {
    const request = new Request(`https://app.supercheck.io/api/auth/${endpoint}`);
    expect((await GET(request)).status).toBe(200);
    expect((await POST(request)).status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith(request);
    expect(mockPost).toHaveBeenCalledWith(request);
  });
});

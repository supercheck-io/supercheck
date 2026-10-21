/** @jest-environment node */
let mockEnabled = true;
const mockAuthHandler = jest.fn();
const mockMetadata = jest.fn();
jest.mock("./config", () => ({ isMcpServerEnabled: () => mockEnabled }));
jest.mock("@/utils/auth", () => ({ auth: { handler: (...a: unknown[]) => mockAuthHandler(...a) } }));
jest.mock("@better-auth/oauth-provider", () => ({
  oauthProviderAuthServerMetadata: () => (request: Request) => mockMetadata(request),
}));

import { authorizationServerMetadata, discoveryPreflight, protectedResourceMetadata } from "./discovery";

const BASE = "https://app.example.com";
const request = (path: string) => new Request(`${BASE}${path}`);
const metadata = {
  issuer: `${BASE}/api/auth`,
  token_endpoint: `${BASE}/api/auth/oauth2/token`,
  introspection_endpoint: `${BASE}/api/auth/oauth2/introspect`,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnabled = true;
});

describe("discovery documents", () => {
  it("answers 404, with CORS, while the MCP server is off, without asking Better Auth", async () => {
    mockEnabled = false;
    for (const handler of [authorizationServerMetadata, protectedResourceMetadata]) {
      const response = await handler(request("/.well-known/x"));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(mockMetadata).not.toHaveBeenCalled();
    expect(mockAuthHandler).not.toHaveBeenCalled();
  });

  it("serves the authorization-server metadata readable cross-origin, advertising only reachable endpoints", async () => {
    mockMetadata.mockResolvedValue(Response.json(metadata));
    const response = await authorizationServerMetadata(request("/.well-known/oauth-authorization-server/api/auth"));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.token_endpoint).toBe(metadata.token_endpoint);
    expect(body).not.toHaveProperty("introspection_endpoint");
  });

  it("serves the protected-resource metadata from Better Auth, with CORS", async () => {
    mockAuthHandler.mockResolvedValue(Response.json({ resource: `${BASE}/api/mcp` }));
    const response = await protectedResourceMetadata(request("/.well-known/oauth-protected-resource/api/mcp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ resource: `${BASE}/api/mcp` });
    expect(mockAuthHandler).toHaveBeenCalledTimes(1);
  });

  it("passes a provider error through, still with CORS", async () => {
    mockMetadata.mockResolvedValue(new Response("nope", { status: 500 }));
    const response = await authorizationServerMetadata(request("/.well-known/x"));
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the CORS preflight for browser-based clients with only GET and OPTIONS", () => {
    const response = discoveryPreflight();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    // Public metadata only: no credentials ever ride on these requests.
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

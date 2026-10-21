/** @jest-environment node */
const mockHandler = jest.fn();
jest.mock("@/lib/mcp/discovery", () => ({
  authorizationServerMetadata: (...a: unknown[]) => mockHandler("as", ...a),
  protectedResourceMetadata: (...a: unknown[]) => mockHandler("prm", ...a),
  discoveryPreflight: () => new Response(null, { status: 204 }),
}));

import * as authorizationServer from "./oauth-authorization-server/api/auth/route";
import * as protectedResource from "./oauth-protected-resource/api/mcp/route";

describe("well-known discovery routes", () => {
  it("publish each document at the path RFC 8414 and RFC 9728 derive from the issuer and the resource", () => {
    mockHandler.mockReturnValue("ok");
    expect(authorizationServer.GET(new Request("https://x/"))).toBe("ok");
    expect(mockHandler).toHaveBeenLastCalledWith("as", expect.any(Request));
    expect(protectedResource.GET(new Request("https://x/"))).toBe("ok");
    expect(mockHandler).toHaveBeenLastCalledWith("prm", expect.any(Request));
  });

  it("answer the CORS preflight", () => {
    expect(authorizationServer.OPTIONS().status).toBe(204);
    expect(protectedResource.OPTIONS().status).toBe(204);
  });

  it("are never cached or prerendered, since they depend on the flag and the request", () => {
    expect(authorizationServer.dynamic).toBe("force-dynamic");
    expect(protectedResource.dynamic).toBe("force-dynamic");
  });
});

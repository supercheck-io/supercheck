import { isOAuthEndpointDenied, pruneUnreachableEndpoints, withReachableEndpointsOnly } from "./http-policy";

const BASE = "https://app.supercheck.io";
const metadata = {
  issuer: `${BASE}/api/auth`,
  authorization_endpoint: `${BASE}/api/auth/oauth2/authorize`,
  token_endpoint: `${BASE}/api/auth/oauth2/token`,
  registration_endpoint: `${BASE}/api/auth/oauth2/register`,
  revocation_endpoint: `${BASE}/api/auth/oauth2/revoke`,
  introspection_endpoint: `${BASE}/api/auth/oauth2/introspect`,
  introspection_endpoint_auth_methods_supported: ["private_key_jwt"],
  introspection_endpoint_auth_signing_alg_values_supported: ["EdDSA"],
  jwks_uri: `${BASE}/api/auth/jwks`,
  scopes_supported: ["mcp:read"],
};

describe("pruneUnreachableEndpoints", () => {
  const pruned = pruneUnreachableEndpoints(metadata);

  it("drops an advertised endpoint the policy denies, with its sibling settings", () => {
    expect(pruned).not.toHaveProperty("introspection_endpoint");
    expect(pruned).not.toHaveProperty("introspection_endpoint_auth_methods_supported");
    expect(pruned).not.toHaveProperty("introspection_endpoint_auth_signing_alg_values_supported");
  });

  it("keeps everything that is reachable, and every non-endpoint field", () => {
    for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint", "jwks_uri", "scopes_supported"]) {
      expect(pruned[key]).toEqual((metadata as Record<string, unknown>)[key]);
    }
  });

  // Whatever the provider advertises, nothing left may point at a path the policy refuses.
  it("never leaves an advertised endpoint that the policy denies", () => {
    for (const [key, value] of Object.entries(pruned)) {
      if (!key.endsWith("_endpoint") || typeof value !== "string") continue;
      const path = new URL(value).pathname;
      expect(["GET", "POST"].some((method) => !isOAuthEndpointDenied(method, path))).toBe(true);
    }
  });

  it("does not modify its input", () => {
    expect(metadata).toHaveProperty("introspection_endpoint");
  });
});

describe("withReachableEndpointsOnly", () => {
  it("rewrites a JSON response and drops the stale content-length", async () => {
    const response = await withReachableEndpointsOnly(
      new Response(JSON.stringify(metadata), { headers: { "content-type": "application/json", "content-length": "999" } }),
    );
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.json()).not.toHaveProperty("introspection_endpoint");
  });

  it("passes an error or non-JSON response through untouched", async () => {
    const error = new Response("nope", { status: 404 });
    expect(await withReachableEndpointsOnly(error)).toBe(error);
    const html = new Response("<p>x</p>", { headers: { "content-type": "text/html" } });
    expect(await withReachableEndpointsOnly(html)).toBe(html);
  });
});

describe("pruneUnreachableEndpoints, unusual values", () => {
  it("leaves alone an *_endpoint value that is not a URL, and non-string values", () => {
    const input = { token_endpoint: "not a url", odd_endpoint: 42, scopes_supported: ["a"] };
    expect(pruneUnreachableEndpoints(input)).toEqual(input);
  });
});

describe("withReachableEndpointsOnly, unusual bodies", () => {
  it("passes a JSON response that is not an object through untouched", async () => {
    const response = new Response("null", { headers: { "content-type": "application/json" } });
    expect(await withReachableEndpointsOnly(response)).toBe(response);
  });

  it("passes unparseable JSON through untouched", async () => {
    const response = new Response("{broken", { headers: { "content-type": "application/json" } });
    expect(await withReachableEndpointsOnly(response)).toBe(response);
  });
});

describe("isOAuthEndpointDenied, undecodable", () => {
  it("denies a guarded path it cannot decode, since it cannot name an allowed endpoint", () => {
    expect(isOAuthEndpointDenied("POST", "/api/auth/oauth2/%E0%A4%A")).toBe(true);
  });

  it.each([
    ["GET", "/api/auth/token"],
    ["GET", "/api/auth/token/"],
    ["GET", "/api/auth/token/anything-new"],
    ["POST", "/api/auth/oauth2/introspect"],
    ["POST", "/api/auth/oauth2/%64elete-consent"],
    ["GET", "/api/auth/oauth2/token"],
  ])("denies %s %s", (method, path) => {
    expect(isOAuthEndpointDenied(method, path)).toBe(true);
  });

  it.each([
    ["POST", "/api/auth/oauth2/token"],
    ["POST", "/api/auth/oauth2/register"],
    ["POST", "/api/auth/oauth2/revoke"],
    ["GET", "/api/auth/oauth2/authorize"],
    ["POST", "/api/auth/oauth2/authorize"],
    ["GET", "/api/auth/jwks"],
    ["POST", "/api/auth/sign-in/email"],
    ["GET", "/api/auth/tokenizer"],
  ])("allows %s %s", (method, path) => {
    expect(isOAuthEndpointDenied(method, path)).toBe(false);
  });
});

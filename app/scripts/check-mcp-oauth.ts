/**
 * Drives the real OAuth 2.1 / MCP authorization server end to end on an
 * in-memory Better Auth instance, using the same plugin configuration the app
 * registers (`createMcpAuthPlugins`). No database is needed.
 *
 * jest mocks `better-auth` (jose is ESM-only), so a Better Auth upgrade could
 * change registration, PKCE, consent, token or refresh behaviour without any
 * unit test noticing. This pins the properties the MCP server's security
 * relies on.
 *
 * Run: npx tsx scripts/check-mcp-oauth.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { createMcpAuthPlugins } from "../src/lib/mcp/auth-plugins";
import { MCP_PROJECT_CLAIM } from "../src/lib/mcp/config";
import { oauthSchema } from "../src/db/schema/oauth";

const BASE = "http://localhost:3000";
const RESOURCE = `${BASE}/api/mcp`;
const REDIRECT = "http://127.0.0.1:8765/callback";
const PROJECT = "11111111-1111-4111-8111-111111111111";

let chosenProject: string | undefined;

const auth = betterAuth({
  baseURL: BASE,
  secret: "mcp-oauth-check-secret-mcp-oauth-check-1234",
  // One empty table per model; the OAuth ones come from the app's own schema names.
  database: memoryAdapter({
    user: [], session: [], account: [], verification: [],
    ...Object.fromEntries(Object.keys(oauthSchema).map((model) => [model, []])),
  }),
  emailAndPassword: { enabled: true },
  plugins: createMcpAuthPlugins({
    resource: RESOURCE,
    dynamicRegistration: true,
    resolveProjectReference: async () => chosenProject,
  }),
});

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

function send(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const { cookie, ...rest } = init;
  return auth.handler(
    new Request(`${BASE}${path}`, {
      ...rest,
      redirect: "manual",
      headers: { origin: BASE, ...(cookie ? { cookie } : {}), ...(rest.headers as Record<string, string>) },
    }),
  );
}

const json = { "content-type": "application/json" };
const form = { "content-type": "application/x-www-form-urlencoded" };
const base64url = (buffer: Buffer) => buffer.toString("base64url");

async function register(body: Record<string, unknown>): Promise<Response> {
  return send("/api/auth/oauth2/register", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ redirect_uris: [REDIRECT], ...body }),
  });
}

async function main(): Promise<void> {
  // --- a signed-in user
  const email = `check-${Date.now()}@example.com`;
  const password = "Check-Passw0rd-12345";
  await send("/api/auth/sign-up/email", { method: "POST", headers: json, body: JSON.stringify({ email, password, name: "Check" }) });
  const signIn = await send("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  check("a user can sign in", signIn.status === 200 && cookie.length > 0);

  // --- discovery
  const metadata = (await (await send("/api/auth/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
  check("advertises exactly mcp:read and offline_access", JSON.stringify(metadata.scopes_supported) === JSON.stringify(["mcp:read", "offline_access"]), JSON.stringify(metadata.scopes_supported));
  check("supports only S256 PKCE", JSON.stringify(metadata.code_challenge_methods_supported) === JSON.stringify(["S256"]));
  check("supports Client ID Metadata Documents", metadata.client_id_metadata_document_supported === true);
  const grants = metadata.grant_types_supported as string[] | undefined;
  check("offers no user-less client_credentials grant", !!grants && !grants.includes("client_credentials"), JSON.stringify(grants));
  const resourceMetadata = await send("/.well-known/oauth-protected-resource/api/mcp");
  const resourceBody = (await resourceMetadata.json()) as { resource?: string };
  check("publishes protected-resource metadata for the MCP URL", resourceMetadata.status === 200 && resourceBody.resource === RESOURCE, `${resourceMetadata.status}`);

  // --- registration policy: public clients with the read scope only
  const publicClient = await register({ client_name: "Check", token_endpoint_auth_method: "none", scope: "mcp:read offline_access" });
  const client = (await publicClient.json()) as { client_id?: string; client_secret?: string };
  check("a public client can register", publicClient.status === 201 && !!client.client_id && !client.client_secret, `${publicClient.status}`);
  check("a client that omits the auth method is refused", (await register({})).status === 400);
  check("a confidential client is refused", (await register({ token_endpoint_auth_method: "client_secret_post" })).status === 400);
  check("a client_credentials client is refused", (await register({ token_endpoint_auth_method: "none", grant_types: ["client_credentials"] })).status === 400);
  check("a wider scope is refused", (await register({ token_endpoint_auth_method: "none", scope: "mcp:read openid email" })).status === 400);
  check("a non-https, non-loopback redirect is refused", (await register({ token_endpoint_auth_method: "none", redirect_uris: ["http://evil.example/cb"] })).status === 400);
  check("a javascript: redirect is refused", (await register({ token_endpoint_auth_method: "none", redirect_uris: ["javascript:alert(1)"] })).status === 400);

  // --- authorize
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const query = new URLSearchParams({
    response_type: "code", client_id: client.client_id as string, redirect_uri: REDIRECT, scope: "mcp:read offline_access",
    state: "xyz", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE,
  });
  const anonymous = await send(`/api/auth/oauth2/authorize?${query}`);
  const signInUrl = new URL(anonymous.headers.get("location") ?? "", BASE);
  check("an anonymous user is sent to sign in with a signed continuation", signInUrl.pathname === "/sign-in" && signInUrl.searchParams.has("sig") && signInUrl.searchParams.has("exp"));

  const resumed = await send(`/api/auth/oauth2/authorize?${signInUrl.search.slice(1)}`, { cookie });
  const consentUrl = new URL(resumed.headers.get("location") ?? "", BASE);
  check("replaying the sign-in redirect after sign-in reaches consent", consentUrl.pathname === "/oauth/consent", consentUrl.pathname);

  const noPkce = await send(`/api/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: client.client_id as string, redirect_uri: REDIRECT, scope: "mcp:read", state: "s", resource: RESOURCE })}`, { cookie });
  check("PKCE is required", (noPkce.headers.get("location") ?? "").includes("error=invalid_request"));

  // --- consent for the chosen project
  chosenProject = PROJECT;
  const consent = await send("/api/auth/oauth2/consent", {
    method: "POST", cookie, headers: json, body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  const consentBody = (await consent.json()) as { url?: string };
  const code = consentBody.url ? new URL(consentBody.url).searchParams.get("code") : null;
  check("approving returns an authorization code to the client", consent.status === 200 && !!code, `${consent.status}`);
  // The consent route clears the choice after every decision, so a new connection asks again.
  chosenProject = undefined;

  const tokenRequest = (extra: Record<string, string>) =>
    send("/api/auth/oauth2/token", {
      method: "POST", headers: form,
      body: new URLSearchParams({ client_id: client.client_id as string, resource: RESOURCE, ...extra }),
    });
  const wrongVerifier = await tokenRequest({ grant_type: "authorization_code", code: code ?? "", redirect_uri: REDIRECT, code_verifier: base64url(randomBytes(32)) });
  check("a wrong PKCE verifier is refused", wrongVerifier.status === 400, `${wrongVerifier.status}`);

  // The wrong-verifier attempt may burn the code; run the happy path on a fresh grant.
  const second = await send(`/api/auth/oauth2/authorize?${query}`, { cookie });
  check("a new connection asks for consent again", new URL(second.headers.get("location") ?? "", BASE).pathname === "/oauth/consent");
  chosenProject = PROJECT;
  const secondConsent = await send("/api/auth/oauth2/consent", {
    method: "POST", cookie, headers: json,
    body: JSON.stringify({ accept: true, oauth_query: new URL(second.headers.get("location") ?? "", BASE).search.slice(1) }),
  });
  const secondCode = new URL(((await secondConsent.json()) as { url: string }).url).searchParams.get("code") as string;
  const tokenResponse = await tokenRequest({ grant_type: "authorization_code", code: secondCode, redirect_uri: REDIRECT, code_verifier: verifier });
  const tokens = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string };
  check("the code exchanges for tokens", tokenResponse.status === 200 && !!tokens.access_token && !!tokens.refresh_token, `${tokenResponse.status}`);

  // --- the access token
  const claims = decodeJwt(tokens.access_token as string);
  const jwks = (await (await send("/api/auth/jwks")).json()) as Parameters<typeof createLocalJWKSet>[0];
  const verified = await jwtVerify(tokens.access_token as string, createLocalJWKSet(jwks), { issuer: `${BASE}/api/auth`, audience: RESOURCE }).catch(() => null);
  check("the access token verifies against the JWKS for this issuer and the MCP audience", verified !== null);
  check("the token is bound to the MCP URL", claims.aud === RESOURCE || (Array.isArray(claims.aud) && claims.aud.includes(RESOURCE)));
  check("the token carries only the read scope (plus refresh)", (claims as { scope?: string }).scope === "mcp:read offline_access", String((claims as { scope?: string }).scope));
  check("the token names the project the user chose", (claims as Record<string, unknown>)[MCP_PROJECT_CLAIM] === PROJECT);
  check("the token lives 15 minutes", (claims.exp ?? 0) - (claims.iat ?? 0) === 900, String((claims.exp ?? 0) - (claims.iat ?? 0)));
  const wrongAudience = await jwtVerify(tokens.access_token as string, createLocalJWKSet(jwks), { audience: "http://localhost:3000/api/other" }).catch(() => null);
  check("the token is refused for a different audience", wrongAudience === null);

  // --- refresh keeps the project
  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token as string });
  const refreshedBody = (await refreshed.json()) as { access_token?: string };
  check("a refresh token yields a new access token for the same project", refreshed.status === 200 && (decodeJwt(refreshedBody.access_token as string) as Record<string, unknown>)[MCP_PROJECT_CLAIM] === PROJECT);

  // --- code replay
  const replay = await tokenRequest({ grant_type: "authorization_code", code: secondCode, redirect_uri: REDIRECT, code_verifier: verifier });
  check("an authorization code cannot be used twice", replay.status === 400, `${replay.status}`);

  // --- the registration policy is a before-hook; confirm it does not leak to other paths
  const signedIn = await auth.api.getSession({ headers: new Headers({ cookie }) });
  check("the OAuth plugins leave normal sessions intact", signedIn?.user.email === email);
}

main().then(
  () => {
    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed:\n - ${failures.join("\n - ")}`);
      process.exit(1);
    }
    console.log("\nMCP OAuth server check passed");
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : error);
    process.exit(1);
  },
);

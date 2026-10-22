/** @jest-environment node */
const mockGetSessionFromCtx = jest.fn();
jest.mock("better-auth/api", () => ({
  ...jest.requireActual("better-auth/api"),
  getSessionFromCtx: (...a: unknown[]) => mockGetSessionFromCtx(...a),
}));

import type { BetterAuthPlugin } from "better-auth";
import {
  createMcpAuthPlugins,
  mcpAuthorizeRequiresResource,
  mcpConsentRequiresProject,
  mcpRegistrationPolicy,
} from "./auth-plugins";
import { MCP_PROJECT_CLAIM } from "./config";

const RESOURCE = "https://app.example.com/api/mcp";

type Hook = { matcher: (ctx: { path?: string }) => boolean; handler: (ctx: unknown) => Promise<unknown> };
const beforeHook = (plugin: BetterAuthPlugin): Hook => (plugin.hooks?.before?.[0] as unknown as Hook);
const run = (plugin: BetterAuthPlugin, ctx: Record<string, unknown>) => beforeHook(plugin).handler(ctx);
const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { status?: string; statusCode?: number; body?: { error?: string; error_description?: string } }) => error,
  );

beforeEach(() => jest.clearAllMocks());

describe("mcpRegistrationPolicy", () => {
  const plugin = mcpRegistrationPolicy();
  const valid = { token_endpoint_auth_method: "none", client_name: "Agent", redirect_uris: ["http://127.0.0.1:8765/cb"] };

  it("only intercepts dynamic client registration", () => {
    expect(beforeHook(plugin).matcher({ path: "/oauth2/register" })).toBe(true);
    for (const path of ["/oauth2/token", "/oauth2/authorize", "/sign-in/email", "/oauth2/register/extra", undefined]) {
      expect(beforeHook(plugin).matcher({ path })).toBe(false);
    }
  });

  it("lets a bounded public-client registration through", async () => {
    await expect(run(plugin, { body: valid })).resolves.not.toThrow();
  });

  it.each([
    ["a confidential client", { ...valid, token_endpoint_auth_method: "client_secret_basic" }],
    ["an omitted method (RFC 7591 says confidential)", { redirect_uris: valid.redirect_uris }],
    ["no body at all", undefined],
  ])("refuses %s with invalid_client_metadata", async (_name, body) => {
    const error = await refusal(run(plugin, { body }));
    expect(error?.body?.error).toBe("invalid_client_metadata");
    expect(error?.body?.error_description).toMatch(/public clients/i);
  });

  it("refuses unbounded or unsafe fields, naming the problem", async () => {
    const error = await refusal(run(plugin, { body: { ...valid, client_name: "Agent\u0000" } }));
    expect(error?.body?.error).toBe("invalid_client_metadata");
    expect(error?.body?.error_description).toMatch(/client_name/);
  });
});

describe("mcpAuthorizeRequiresResource", () => {
  const plugin = mcpAuthorizeRequiresResource(RESOURCE);

  it("only intercepts the authorize endpoint", () => {
    expect(beforeHook(plugin).matcher({ path: "/oauth2/authorize" })).toBe(true);
    expect(beforeHook(plugin).matcher({ path: "/oauth2/token" })).toBe(false);
  });

  it.each([
    ["the query string (GET)", { query: { resource: RESOURCE } }],
    ["the form body (POST)", { body: { resource: RESOURCE } }],
  ])("accepts the resource in %s", async (_name, ctx) => {
    await expect(run(plugin, ctx)).resolves.not.toThrow();
  });

  it.each([
    ["no resource", {}],
    ["a different resource", { query: { resource: "https://evil.example/api/mcp" } }],
    ["a near-miss resource", { query: { resource: `${RESOURCE}/` } }],
    ["the resource twice in the query", { query: { resource: [RESOURCE, RESOURCE] } }],
    ["the resource in both query and body", { query: { resource: RESOURCE }, body: { resource: RESOURCE } }],
    ["the right resource plus another", { query: { resource: [RESOURCE, "https://evil.example"] } }],
  ])("refuses %s with invalid_target", async (_name, ctx) => {
    const error = await refusal(run(plugin, ctx));
    expect(error?.body?.error).toBe("invalid_target");
    expect(error?.body?.error_description).toContain(RESOURCE);
  });
});

describe("mcpConsentRequiresProject", () => {
  const resolve = jest.fn();
  const plugin = mcpConsentRequiresProject(resolve);
  const session = { user: { id: "u1" }, session: { id: "s1" } };

  it("only intercepts the consent endpoint", () => {
    expect(beforeHook(plugin).matcher({ path: "/oauth2/consent" })).toBe(true);
    expect(beforeHook(plugin).matcher({ path: "/oauth2/authorize" })).toBe(false);
  });

  it("lets an approval through when a project is being connected, resolving it for the signed-in user", async () => {
    mockGetSessionFromCtx.mockResolvedValue(session);
    resolve.mockResolvedValue("project-1");
    await expect(run(plugin, { body: { accept: true } })).resolves.not.toThrow();
    expect(resolve).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("refuses an approval that names no project, so no project-less consent is recorded", async () => {
    mockGetSessionFromCtx.mockResolvedValue(session);
    resolve.mockResolvedValue(undefined);
    const error = await refusal(run(plugin, { body: { accept: true } }));
    expect(error?.body?.error).toBe("invalid_request");
    expect(error?.body?.error_description).toMatch(/choose a project/i);
  });

  it.each([[false], [undefined], ["true"], [1]])("ignores a decision that is not an approval (accept=%p)", async (accept) => {
    await expect(run(plugin, { body: { accept } })).resolves.not.toThrow();
    expect(mockGetSessionFromCtx).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves a missing session to the consent endpoint itself", async () => {
    mockGetSessionFromCtx.mockResolvedValue(null);
    await expect(run(plugin, { body: { accept: true } })).resolves.not.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("surfaces an unexpected resolver failure rather than treating it as 'no project'", async () => {
    mockGetSessionFromCtx.mockResolvedValue(session);
    resolve.mockRejectedValue(new Error("db down"));
    await expect(run(plugin, { body: { accept: true } })).rejects.toThrow("db down");
  });
});

describe("createMcpAuthPlugins", () => {
  const resolveProjectReference = jest.fn<Promise<string | undefined>, [{ userId: string }]>(async () => undefined);
  const build = (overrides = {}) =>
    createMcpAuthPlugins({ resource: RESOURCE, dynamicRegistration: true, resolveProjectReference, ...overrides });
  type Provider = BetterAuthPlugin & { options?: Record<string, unknown> };
  const provider = (plugins: BetterAuthPlugin[]) =>
    plugins.find((p) => (p as Provider).options && "grantTypes" in ((p as Provider).options ?? {})) as Provider;

  it("registers the signing, guard, provider and metadata-document plugins, guards before the provider", () => {
    const ids = build().map((plugin) => plugin.id);
    expect(ids).toEqual([
      "jwt",
      "supercheck-mcp-registration-policy",
      "supercheck-mcp-authorize-requires-resource",
      "supercheck-mcp-consent-requires-project",
      "oauth-provider",
      "cimd",
    ]);
  });

  it("is a read-only, public-client, authorization-code and refresh-token server", () => {
    const options = provider(build()).options as Record<string, unknown>;
    expect(options.scopes).toEqual(["mcp:read", "offline_access"]);
    expect(options.grantTypes).toEqual(["authorization_code", "refresh_token"]);
    expect(options.loginPage).toBe("/sign-in");
    expect(options.consentPage).toBe("/oauth/consent");
    // Tokens are audience-bound to exactly this resource.
    expect(options.resources).toEqual([RESOURCE]);
    expect(options.accessTokenExpiresIn).toBe(15 * 60);
    expect(options.refreshTokenExpiresIn).toBe(30 * 24 * 60 * 60);
    expect(options.clientRegistrationAllowedScopes).toEqual(["mcp:read", "offline_access"]);
    expect(options.clientRegistrationDefaultApplicationType).toBe("infer");
  });

  it.each([[true], [false]])("follows the dynamic-registration setting (%p) for both registration switches", (enabled) => {
    const options = provider(build({ dynamicRegistration: enabled })).options as Record<string, unknown>;
    expect(options.allowDynamicClientRegistration).toBe(enabled);
    expect(options.allowUnauthenticatedClientRegistration).toBe(enabled);
  });

  it("records consent against the project being connected, and puts it in the token", async () => {
    resolveProjectReference.mockResolvedValue("project-1");
    const options = provider(build()).options as {
      postLogin: { consentReferenceId: (c: { user: { id: string } }) => Promise<string | undefined>; shouldRedirect: () => boolean };
      customAccessTokenClaims: (c: { referenceId?: string; user?: {id:string} }) => Record<string, unknown>;
    };
    await expect(options.postLogin.consentReferenceId({ user: { id: "u1" } })).resolves.toBe("project-1");
    expect(resolveProjectReference).toHaveBeenCalledWith({ userId: "u1" });
    // No extra screen between sign-in and consent: the project is chosen on the consent screen itself.
    expect(options.postLogin.shouldRedirect()).toBe(false);
    expect(options.customAccessTokenClaims({ referenceId: "project-1", user: {id:"u1"} })).toEqual({ [MCP_PROJECT_CLAIM]: "project-1" });
    expect(options.customAccessTokenClaims({user:{id:"u1"}})).toEqual({ [MCP_PROJECT_CLAIM]: null });
  });

  it("does not add a signed user JWT to session responses", () => {
    const jwtPlugin = build()[0] as BetterAuthPlugin & { options?: { disableSettingJwtHeader?: boolean } };
    expect(jwtPlugin.options?.disableSettingJwtHeader).toBe(true);
  });
});


describe("MCP token account suspension", () => {
  const plugins = createMcpAuthPlugins({resource:RESOURCE,dynamicRegistration:false,resolveProjectReference:async()=>"project"});
  const claims = ((plugins.find(p=>p.id === "oauth-provider") as BetterAuthPlugin)?.options as {customAccessTokenClaims:(ctx:object)=>object}).customAccessTokenClaims;
  it.each([undefined, null, {id:"u",banned:true}, {id:"u",banned:true,banExpires:new Date(Date.now()+60000)}, {id:"u",banned:true,banExpires:"invalid"}])("rejects unavailable or suspended owners %j", user=>{
    expect(()=>claims({referenceId:"project",user})).toThrow();
  });
  it.each([{id:"u",banned:false},{id:"u",banned:true,banExpires:new Date(0)}])("permits active and expired temporary bans %j", user=>{
    expect(claims({referenceId:"project",user})).toEqual({[MCP_PROJECT_CLAIM]:"project"});
  });
});

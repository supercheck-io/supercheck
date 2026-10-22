import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { isCredentialOwnerActive } from "@/lib/security/credential-owner";
import type { BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { registrationProblem } from "./client-metadata";
import { fetchClientMetadataResource as fetchMetadataOverNode } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_PROJECT_CLAIM,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  MCP_SCOPES,
} from "./config";

/**
 * Rejects registrations that are not public clients, or whose fields are unbounded
 * or unsafe to store (see registrationProblem).
 *
 * Open dynamic registration would otherwise mint confidential clients with a
 * secret for anyone who asks. MCP clients are public (PKCE, no secret), so
 * anything else is refused. Per RFC 7591 an omitted method means a confidential
 * client, so it is refused too.
 */
export function mcpRegistrationPolicy(): BetterAuthPlugin {
  return {
    id: "supercheck-mcp-registration-policy",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/register",
          handler: createAuthMiddleware(async (ctx) => {
            const method = (ctx.body as { token_endpoint_auth_method?: unknown } | undefined)
              ?.token_endpoint_auth_method;
            if (method !== "none") {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_client_metadata",
                error_description:
                  'Only public clients can register: set token_endpoint_auth_method to "none"',
              });
            }
            // Registration is open to anyone and everything in it is stored and shown to users.
            const problem = registrationProblem(ctx.body);
            if (problem) {
              throw new APIError("BAD_REQUEST", { error: "invalid_client_metadata", error_description: problem });
            }
          }),
        },
      ],
    },
  };
}

/**
 * Requires every authorization request to name the MCP server as its resource.
 *
 * A token is audience-bound to the resource it was requested for. Without one,
 * Better Auth issues an opaque token with no audience, which no resource server
 * here understands. Refusing it up front gives the client a clear error instead
 * of a token that never works.
 */
export function mcpAuthorizeRequiresResource(resource: string): BetterAuthPlugin {
  return {
    id: "supercheck-mcp-authorize-requires-resource",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            // The authorize endpoint accepts GET (query) and POST (form body).
            const named = (source: unknown) => {
              const value = (source as { resource?: unknown } | undefined)?.resource;
              return value === undefined ? [] : Array.isArray(value) ? value : [value];
            };
            const values = [...named(ctx.query), ...named(ctx.body)];
            if (values.length !== 1 || values[0] !== resource) {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_target",
                error_description: `The resource parameter must be ${resource}`,
              });
            }
          }),
        },
      ],
    },
  };
}

type ResolveProject = (input: { userId: string }) => Promise<string | undefined>;

/**
 * Refuses to record consent unless a project was chosen.
 *
 * Better Auth looks a consent up by (client, user, reference id). A consent with
 * no reference id would later cover every authorization request that also has
 * none, skipping the connect screen, and would yield a token that names no
 * project and could not be listed or disconnected. Approval over HTTP is already
 * refused; this guards the in-process path the connect screen uses, including a
 * lookup that failed or a choice that was cleared by a concurrent request.
 */
export function mcpConsentRequiresProject(resolve: ResolveProject): BetterAuthPlugin {
  return {
    id: "supercheck-mcp-consent-requires-project",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/oauth2/consent",
          handler: createAuthMiddleware(async (ctx) => {
            if ((ctx.body as { accept?: unknown } | undefined)?.accept !== true) return;
            const session = await getSessionFromCtx(ctx);
            // No session is rejected by the consent endpoint itself.
            if (!session) return;
            const project = await resolve({ userId: session.user.id });
            if (!project) {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_request",
                error_description: "Choose a project before approving",
              });
            }
          }),
        },
      ],
    },
  };
}

export interface McpAuthPluginOptions {
  /** Canonical MCP resource URL; access tokens are audience-bound to it. */
  resource: string;
  /** Accept unauthenticated Dynamic Client Registration (CIMD is always on). */
  dynamicRegistration: boolean;
  /**
   * The project being connected by the approval in progress, or undefined when
   * there is none. Consent is recorded against this value.
   */
  resolveProjectReference: ResolveProject;
  /**
   * How Client ID Metadata Documents are fetched. Defaults to Better Auth's Node
   * transport, which refuses private addresses, redirects and oversized bodies.
   * Replaceable so tests can serve documents without network access.
   */
  fetchClientMetadataResource?: ClientMetadataResourceFetch;
}

/**
 * OAuth 2.1 authorization server for the remote MCP server.
 *
 * - `jwt()` signs access tokens; `mcp()` is the OAuth provider and binds tokens
 *   to the MCP resource URL; `cimd()` accepts Client ID Metadata Documents.
 * - Only the read-only `mcp:read` scope exists, and only the
 *   authorization-code and refresh-token grants: there is no user-less
 *   (`client_credentials`) path.
 * - Consent is recorded per project via `consentReferenceId`, so a token can
 *   only ever act on the one project the user picked.
 * - Public clients only (PKCE).
 */
export function createMcpAuthPlugins(options: McpAuthPluginOptions) {
  return [
    // Signs access tokens. By default the plugin also adds a signed JWT of the
    // user (id, email, name) to every get-session response; nothing uses it and
    // it would sign on every authenticated request.
    jwt({ disableSettingJwtHeader: true }),
    mcpRegistrationPolicy(),
    mcpAuthorizeRequiresResource(options.resource),
    mcpConsentRequiresProject(options.resolveProjectReference),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      resource: options.resource,
      scopes: [...MCP_SCOPES],
      grantTypes: ["authorization_code", "refresh_token"],
      accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: MCP_REFRESH_TOKEN_TTL_SECONDS,
      allowDynamicClientRegistration: options.dynamicRegistration,
      allowUnauthenticatedClientRegistration: options.dynamicRegistration,
      // Coding agents register with a loopback redirect URI and often omit
      // application_type; infer "native" from it instead of rejecting them.
      clientRegistrationDefaultApplicationType: "infer",
      clientRegistrationAllowedScopes: [...MCP_SCOPES],
      postLogin: {
        // The project is chosen on the consent screen itself, so no extra
        // redirect happens between sign-in and consent.
        page: "/oauth/consent",
        shouldRedirect: () => false,
        consentReferenceId: ({ user }) =>
          options.resolveProjectReference({ userId: user.id }),
      },
      customAccessTokenClaims: ({ referenceId, user }) => {
        if (!isCredentialOwnerActive(user ? { banned: user.banned, banExpires: user.banExpires } : null)) {
          throw new APIError("FORBIDDEN", {
            error: "access_denied",
            error_description: "Account is suspended or unavailable",
          });
        }
        return { [MCP_PROJECT_CLAIM]: referenceId ?? null };
      },
    }),
    cimd({
      fetchClientMetadataResource: options.fetchClientMetadataResource ?? fetchMetadataOverNode,
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
}

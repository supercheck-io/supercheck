import { APIError, createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_PROJECT_CLAIM,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  MCP_SCOPES,
} from "./config";

/**
 * Rejects registrations that are not public clients.
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
   * The project the signed-in user chose on the connect screen, or undefined
   * when none was chosen. Consent is recorded against this value.
   */
  resolveProjectReference: (input: {
    sessionId: string;
    userId: string;
  }) => Promise<string | undefined>;
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
    jwt(),
    mcpRegistrationPolicy(),
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
        consentReferenceId: ({ user, session }) =>
          options.resolveProjectReference({ sessionId: session.id, userId: user.id }),
      },
      customAccessTokenClaims: ({ referenceId }) => ({
        [MCP_PROJECT_CLAIM]: referenceId ?? null,
      }),
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
  ];
}

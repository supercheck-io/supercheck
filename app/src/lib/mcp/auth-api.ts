import { auth } from "@/utils/auth";

/**
 * The OAuth endpoints Supercheck calls in-process. The MCP plugins are only
 * registered when MCP_SERVER_ENABLED=true, so `auth.api`'s inferred type does
 * not include them; this narrow interface is the one place that says so.
 */
export interface McpAuthApi {
  oauth2Consent(input: {
    headers: Headers;
    body: { accept: boolean; oauth_query: string };
  }): Promise<{ url?: string; redirect_uri?: string } | undefined>;
  getOAuthClientPublic(input: {
    headers: Headers;
    query: { client_id: string };
  }): Promise<{ client_id?: string; client_name?: string; client_uri?: string; logo_uri?: string } | null>;
}

export function mcpAuthApi(): McpAuthApi {
  return auth.api as unknown as McpAuthApi;
}

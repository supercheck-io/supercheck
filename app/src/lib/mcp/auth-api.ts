import { auth } from "@/utils/auth";

/**
 * The OAuth endpoints Supercheck calls in-process. The MCP plugins are only
 * registered when MCP_SERVER_ENABLED=true, so `auth.api`'s inferred type does
 * not include them; this narrow interface is the one place that says so.
 */
export interface McpAuthApi {
  getOAuthClientPublic(input: {
    headers: Headers;
    query: { client_id: string };
  }): Promise<{ client_id?: string; client_name?: string; client_uri?: string; logo_uri?: string } | null>;
}

export function mcpAuthApi(): McpAuthApi {
  return auth.api as unknown as McpAuthApi;
}

// Request headers that identify the caller. The consent endpoint needs the session cookie and an
// origin to check; the rest keep rate limiting and audit logging keyed to the real client.
const FORWARDED_HEADERS = ["cookie", "origin", "user-agent", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"] as const;

export class ConsentRejectedError extends Error {
  constructor(readonly status: number, readonly reason: string) {
    super(`Consent was rejected (${status})`);
    this.name = "ConsentRejectedError";
  }
}

/**
 * Records the user's decision on a signed authorization request and returns where to send
 * the browser next (the client's redirect URI with a code, or an error).
 *
 * Better Auth's consent endpoint needs a real `Request` (called through `auth.api` without
 * one it answers "request not found"), so this goes through the handler, as an HTTP call would.
 * The route is not exposed over HTTP: this is the only way in, and the caller has already
 * checked the origin, the session and the chosen project.
 */
export async function submitConsent(input: {
  headers: Headers;
  accept: boolean;
  oauthQuery: string;
}): Promise<{ url: string }> {
  const base = process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("BETTER_AUTH_URL is required to submit consent");

  const headers = new Headers({ "content-type": "application/json" });
  for (const name of FORWARDED_HEADERS) {
    const value = input.headers.get(name);
    if (value) headers.set(name, value);
  }

  const response = await auth.handler(
    new Request(new URL("/api/auth/oauth2/consent", base), {
      method: "POST",
      headers,
      body: JSON.stringify({ accept: input.accept, oauth_query: input.oauthQuery }),
    }),
  );
  const body = (await response.json().catch(() => null)) as { url?: string; redirect_uri?: string; error?: string } | null;
  const url = body?.url ?? body?.redirect_uri;
  if (!response.ok || !url) throw new ConsentRejectedError(response.status, body?.error ?? "consent_failed");
  return { url };
}

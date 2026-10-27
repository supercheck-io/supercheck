export type AtlassianAuth = {
  headers: Record<string, string>;
  /** Cloud uses email + API token (Basic); Data Center uses a bearer personal access token. */
  mode: "cloud" | "data_center";
};

export function atlassianAuth(
  provider: string,
  endpoint: string,
  token: string | null,
  email: string | null,
): AtlassianAuth {
  if (!token) {
    throw new Error(
      `invalid credentials: ${provider} requires a read-only API token`,
    );
  }
  if (email) {
    return {
      mode: "cloud",
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      },
    };
  }
  if (new URL(endpoint).hostname.toLowerCase().endsWith(".atlassian.net")) {
    throw new Error(
      `invalid credentials: ${provider} Cloud requires the Atlassian account email and an API token. A bearer token alone works only for Data Center.`,
    );
  }
  return { mode: "data_center", headers: { Authorization: `Bearer ${token}` } };
}

/**
 * The consent route hands the browser a redirect back to the MCP client.
 * Better Auth only issues redirects to the client's registered redirect URIs,
 * and native apps legitimately use custom schemes (cursor://, vscode://), so
 * this is a backstop: it refuses schemes that execute or render content in the
 * current page rather than leaving the site.
 */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "view-source:", "filesystem:",
]);

export function isSafeRedirectTarget(value: string | undefined | null): value is string {
  if (!value || value.length > 4096) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return !FORBIDDEN_SCHEMES.has(url.protocol.toLowerCase());
}

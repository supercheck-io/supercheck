const ACRONYMS: Record<string, string> = {
  cli: "CLI",
  mcp: "MCP",
  api: "API",
  sso: "SSO",
  oidc: "OIDC",
  ip: "IP",
  id: "ID",
  url: "URL",
  ci: "CI",
  sre: "SRE",
  ai: "AI",
};

/**
 * Turn a raw audit action (for example `cli_token_created`) into a readable
 * label ("CLI token created"). The raw value stays the source of truth for
 * filtering; this is presentation only.
 */
export function formatAuditAction(action: string): string {
  const words = action
    .trim()
    .split(/[\s_.:/-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  if (words.length === 0) return action;

  return words
    .map((word, index) => {
      if (ACRONYMS[word]) return ACRONYMS[word];
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

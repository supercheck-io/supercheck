/**
 * Domains that can never receive mail (RFC 2606 / RFC 6761 / RFC 7505 null MX).
 * Sending to them only produces bounces, and a high bounce rate gets the SMTP account blocked.
 */
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["example", "invalid", "test", "localhost"];

function configuredBlockedDomains(): string[] {
  return (process.env.SMTP_BLOCKED_RECIPIENT_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

const matchesDomain = (domain: string, blocked: string) =>
  domain === blocked || domain.endsWith(`.${blocked}`);

/** True when the address is on a domain that cannot (or must not) receive mail. */
export function isUndeliverableRecipient(email: string): boolean {
  // "Name <a@b.io>": judge the mailbox SMTP will use, not the display form.
  const address = /<([^<>]*)>\s*$/.exec(email)?.[1] ?? email;
  const domain = address.trim().toLowerCase().split("@").pop()?.replace(/\.$/, "") ?? "";
  if (!domain) return true;
  // Dotless hosts (an internal relay on a self-hosted install) are allowed, except the reserved names.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.includes(tld)) return true;
  return [...RESERVED_DOMAINS, ...configuredBlockedDomains()].some((blocked) =>
    matchesDomain(domain, blocked),
  );
}

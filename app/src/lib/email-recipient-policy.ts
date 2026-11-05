import { Resolver } from "node:dns/promises";
import { isSelfHosted } from "@/lib/feature-flags";

// Short and single-try: a dead resolver must not stall a send (lookup errors fail open).
const resolver = new Resolver({ timeout: 2000, tries: 1 });

/**
 * Domains that can never receive mail (RFC 2606 / RFC 6761 / RFC 7505 null MX).
 * Sending to them only produces bounces, and a high bounce rate gets the SMTP account blocked.
 */
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["example", "invalid", "test", "localhost"];

const matchesDomain = (domain: string, blocked: string) =>
  domain === blocked || domain.endsWith(`.${blocked}`);

const recipientDomain = (email: string) =>
  email.trim().toLowerCase().split("@").pop()?.replace(/\.$/, "") ?? "";

/** True when the address is on a domain that cannot (or must not) receive mail. */
export function isUndeliverableRecipient(email: string): boolean {
  const domain = recipientDomain(email);
  if (!domain) return true;
  // Dotless hosts (an internal relay on a self-hosted install) are allowed, except the reserved names.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.includes(tld)) return true;
  return RESERVED_DOMAINS.some((blocked) =>
    matchesDomain(domain, blocked),
  );
}

const MX_CACHE_TTL_MS = 10 * 60 * 1000;
const MX_CACHE_MAX = 1000;
const mxCache = new Map<string, { acceptsMail: boolean; at: number }>();

/**
 * False only when DNS says the domain cannot take mail: it does not exist (ENOTFOUND),
 * has no MX record (ENODATA), or publishes a null MX. An A record alone is not enough (no
 * RFC 5321 implicit MX): the test domains that bounced had one. Any other DNS failure fails
 * open, so a resolver hiccup never drops a real alert.
 */
async function domainAcceptsMail(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_CACHE_TTL_MS) return cached.acceptsMail;
  let acceptsMail = true;
  try {
    const records = await resolver.resolveMx(domain);
    acceptsMail = records.some((record) => record.exchange && record.exchange !== ".");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    acceptsMail = code !== "ENOTFOUND" && code !== "ENODATA";
  }
  if (mxCache.size >= MX_CACHE_MAX) mxCache.clear();
  mxCache.set(domain, { acceptsMail, at: Date.now() });
  return acceptsMail;
}

/** Returns the lowercased addresses that are on the bounce suppression list. */
export type SuppressionLookup = (emails: string[]) => Promise<Set<string>>;

/**
 * Splits recipients into those worth sending to and those that would only bounce:
 * reserved or blocked domains, domains without MX, and addresses that hard-bounced before.
 */
export async function partitionRecipients(
  recipients: string[],
  isSuppressed?: SuppressionLookup,
): Promise<{ deliverable: string[]; skipped: string[] }> {
  // Cloud only: a self-hosted relay may deliver to internal domains that publish no MX.
  const checkMx = !isSelfHosted();
  const domains = [
    ...new Set(
      recipients
        .filter((recipient) => !isUndeliverableRecipient(recipient))
        .map(recipientDomain)
        .filter((domain) => checkMx && domain.includes(".")),
    ),
  ];
  const acceptsMail = new Map(
    await Promise.all(
      domains.map(async (domain) => [domain, await domainAcceptsMail(domain)] as const),
    ),
  );
  let suppressed = new Set<string>();
  if (isSuppressed && checkMx && recipients.length > 0) {
    try {
      suppressed = await isSuppressed(recipients.map((r) => r.trim().toLowerCase()));
    } catch {
      // Fail open: a database hiccup must not drop alerts.
    }
  }
  const deliverable: string[] = [];
  const skipped: string[] = [];
  for (const recipient of recipients) {
    const blocked =
      isUndeliverableRecipient(recipient) ||
      suppressed.has(recipient.trim().toLowerCase()) ||
      acceptsMail.get(recipientDomain(recipient)) === false;
    (blocked ? skipped : deliverable).push(recipient);
  }
  return { deliverable, skipped };
}

/** Test hook: forget cached MX answers. */
export function clearRecipientMxCache() {
  mxCache.clear();
}

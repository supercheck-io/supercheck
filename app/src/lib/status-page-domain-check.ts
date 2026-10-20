import {
  resolveCname,
  resolveTxt,
  resolve4,
  resolve6,
} from "node:dns/promises";
import { getStatusPageDomainOwnershipRecord } from "./status-page-domain-guidance";
import { getStatusPageDomainVerificationTargets } from "./status-page-domain";

export type DomainCheckResult = "valid" | "invalid" | "unavailable";

/**
 * DNS failures never detach a verified custom domain. A published page keeps
 * its hostname until an operator changes it; a failed lookup only means the
 * hostname is not resolving right now, which is recoverable by fixing DNS.
 *
 * The result is still classified for logging and tests: "invalid" is a
 * successful lookup whose records point elsewhere, while "unavailable" means
 * the resolver could not answer (ENOTFOUND, ENODATA, EAI_AGAIN, timeouts).
 */
export async function checkStatusPageDomain(
  domain: string,
  pageId: string,
): Promise<DomainCheckResult> {
  const normalize = (value: string) => value.toLowerCase().replace(/\.$/, "");
  try {
    const targets = getStatusPageDomainVerificationTargets().map(normalize);
    const cnames = await resolveCname(domain);
    const matched = cnames.filter((cname) =>
      targets.includes(normalize(cname)),
    );
    if (!matched.length) return "invalid";
    const ownership = getStatusPageDomainOwnershipRecord(domain, pageId);
    const records = await resolveTxt(ownership.name);
    if (!records.some((record) => record.join("") === ownership.value))
      return "invalid";
    const addresses = await Promise.allSettled(
      matched.flatMap((target) => [resolve4(target), resolve6(target)]),
    );
    return addresses.some(
      (result) => result.status === "fulfilled" && result.value.length > 0,
    )
      ? "valid"
      : "unavailable";
  } catch {
    // ENOTFOUND, ENODATA, EAI_AGAIN, and timeouts all mean the resolver could
    // not give an answer. Only a successful lookup with mismatched records is
    // definitive evidence that the domain no longer belongs to this page.
    return "unavailable";
  }
}

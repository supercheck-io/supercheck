import {
  resolveCname,
  resolveTxt,
  resolve4,
  resolve6,
} from "node:dns/promises";
import { getStatusPageDomainOwnershipRecord } from "./status-page-domain-guidance";
import { getStatusPageDomainVerificationTargets } from "./status-page-domain";

export const DOMAIN_UNVERIFY_FAILURE_LIMIT = 3;

export type DomainCheckResult = "valid" | "invalid" | "unavailable";

export function nextDomainVerificationState(
  result: DomainCheckResult,
  state: { verified: boolean; failureCount: number },
): { verified: boolean; failureCount: number } {
  if (result === "valid") return { verified: true, failureCount: 0 };
  if (result === "unavailable")
    return { verified: state.verified, failureCount: 0 };
  const failureCount = Math.min(
    state.failureCount + 1,
    DOMAIN_UNVERIFY_FAILURE_LIMIT,
  );
  return {
    verified:
      failureCount >= DOMAIN_UNVERIFY_FAILURE_LIMIT ? false : state.verified,
    failureCount,
  };
}

/** DNS failures are transient unless authoritative records are missing or mismatched. */
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

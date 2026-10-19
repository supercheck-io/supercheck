import {
  resolveCname,
  resolveTxt,
  resolve4,
  resolve6,
} from "node:dns/promises";
import { getStatusPageDomainOwnershipRecord } from "./status-page-domain-guidance";
import { getStatusPageDomainVerificationTargets } from "./status-page-domain";

/** DNS failures are transient unless authoritative records are missing or mismatched. */
export async function checkStatusPageDomain(
  domain: string,
  pageId: string,
): Promise<"valid" | "invalid" | "unavailable"> {
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
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOTFOUND" || code === "ENODATA"
      ? "invalid"
      : "unavailable";
  }
}

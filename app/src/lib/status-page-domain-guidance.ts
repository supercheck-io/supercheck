export const STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE =
  "Only the custom hostname should be a CNAME. Do not add A/AAAA records on that same hostname.";

export function getStatusPageCustomDomainTargetResolutionHint(
  hostname: string
): string {
  return `The target hostname ${hostname} must already be live and publicly resolvable before verification can succeed. It may itself resolve via A/AAAA or wildcard DNS records, and that is normal.`;
}

export function getStatusPageCustomDomainTargetResolutionError(
  hostnames: string[]
): string {
  const uniqueHostnames = Array.from(new Set(hostnames));
  const hostnameList = uniqueHostnames.join(", ");
  const isPlural = uniqueHostnames.length > 1;

  return `CNAME points to ${hostnameList}, but ${isPlural ? "those target hostnames are" : "that target hostname is"} not publicly resolvable yet. ${STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE} Instead, ensure ${hostnameList} ${isPlural ? "are" : "is"} live and publicly resolvable (often via A/AAAA or wildcard DNS records), then wait for DNS propagation before verifying again.`;
}

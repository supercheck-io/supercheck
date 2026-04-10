export const STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE =
  "Create a CNAME for the custom hostname only. Do not add A/AAAA records on that same hostname.";

export const STATUS_PAGE_CUSTOM_DOMAIN_TARGET_RECORD_GUIDANCE =
  "Before verification, the target hostname must already point to your app, usually via an A/AAAA record or a wildcard record that already covers it.";

export function getStatusPageCustomDomainTargetResolutionHint(
  hostname: string
): string {
  return `The target hostname ${hostname} must already point to your app before verification can succeed, usually via an A/AAAA record or a wildcard record that already covers it.`;
}

export function getStatusPageCustomDomainTargetResolutionError(
  hostnames: string[]
): string {
  const uniqueHostnames = Array.from(new Set(hostnames));
  const hostnameList = uniqueHostnames.join(", ");
  const isPlural = uniqueHostnames.length > 1;

  return `CNAME points to ${hostnameList}, but ${isPlural ? "those target hostnames are" : "that target hostname is"} not publicly resolvable yet. ${STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE} ${STATUS_PAGE_CUSTOM_DOMAIN_TARGET_RECORD_GUIDANCE} Wait for DNS propagation and verify again.`;
}

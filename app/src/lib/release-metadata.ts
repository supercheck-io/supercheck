const RELEASE_VERSION =
  /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

/**
 * Formats an immutable release version for user-visible diagnostics.
 * Moving branch tags, SHAs, and arbitrary build input are intentionally hidden.
 */
export function getReleaseVersionBadge(version?: string): string | undefined {
  const candidate = version?.trim();
  if (!candidate || !RELEASE_VERSION.test(candidate)) return undefined;

  return candidate.startsWith("v") ? candidate : `v${candidate}`;
}

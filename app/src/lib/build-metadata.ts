const IMMUTABLE_GITHUB_TREE_PATH = /^\/[^/]+\/[^/]+\/tree\/([0-9a-f]{40})\/?$/i;

/**
 * Returns a compact, immutable build label for user-visible diagnostics.
 * Branch names and arbitrary URLs are intentionally rejected because they can
 * move independently of the running image.
 */
export function getSourceBuildBadge(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;

  try {
    const url = new URL(sourceUrl);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;

    const revision = url.pathname.match(IMMUTABLE_GITHUB_TREE_PATH)?.[1];
    return revision ? `build ${revision.slice(0, 7).toLowerCase()}` : undefined;
  } catch {
    return undefined;
  }
}

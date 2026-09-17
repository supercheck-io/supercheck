/**
 * Release version resolution for the worker service.
 *
 * The release pipeline injects `SUPERCHECK_VERSION` from the release tag via
 * `docker/metadata-action`. Local and development runs fall back to
 * `npm_package_version`, which npm populates. A neutral `unknown` fallback is
 * used instead of a hardcoded version literal so a deployment can never
 * silently report a stale release.
 */
const UNKNOWN_VERSION = 'unknown';

function firstNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolves the release version reported by worker diagnostics.
 *
 * Precedence:
 * 1. `SUPERCHECK_VERSION` - injected by the release build.
 * 2. `npm_package_version` - present when the worker runs through npm scripts.
 * 3. `unknown` - no release identity available.
 */
export function getServiceVersion(): string {
  return (
    firstNonEmpty(process.env.SUPERCHECK_VERSION) ??
    firstNonEmpty(process.env.npm_package_version) ??
    UNKNOWN_VERSION
  );
}

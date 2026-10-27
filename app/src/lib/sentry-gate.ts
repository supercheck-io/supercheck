/**
 * Sentry enable gate. Must NOT import @sentry/*: callers check it before loading
 * the SDK, so disabled and self-hosted deployments never load Sentry code.
 */
import { isSelfHosted } from "@/lib/feature-flags";

/** Returns the DSN when Sentry may run (Supercheck Cloud with SENTRY_DSN), else null. */
export function getSentryDsn(
  env: Record<string, string | undefined> = process.env,
  selfHosted: boolean = isSelfHosted(),
): string | null {
  const dsn = env.SENTRY_DSN?.trim();
  return dsn && !selfHosted ? dsn : null;
}

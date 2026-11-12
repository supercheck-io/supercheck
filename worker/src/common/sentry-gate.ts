/**
 * Sentry enable gate. Must NOT import @sentry/*: callers check it before loading
 * the SDK, so disabled and self-hosted deployments never load Sentry code.
 */
const isSelfHostedEnv = (env: Record<string, string | undefined>): boolean =>
  ['true', '1'].includes(env.SELF_HOSTED?.trim().toLowerCase() ?? '');

/**
 * Returns the DSN when Sentry may run (Supercheck Cloud with SENTRY_DSN), else null.
 * Always null for private agents: they run on customer infrastructure.
 */
export function getSentryDsn(
  env: Record<string, string | undefined> = process.env,
  selfHosted: boolean = isSelfHostedEnv(env),
): string | null {
  const dsn = env.SENTRY_DSN?.trim();
  const privateAgent = env.SUPERCHECK_RUNTIME_MODE?.trim() === 'private-agent';
  return dsn && !selfHosted && !privateAgent ? dsn : null;
}

/**
 * Runtime-mode helpers shared by startup validation.
 *
 * SELF_HOSTED follows the app's feature flag: "true" or "1", case-insensitive.
 */
export function isSelfHostedEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.SELF_HOSTED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * The Private Agent profile runs a separate runtime (see main.ts) that never
 * starts queue consumers or execution Jobs, so worker-consumer validation must
 * not apply to it. It sets NODE_ENV=production without SELF_HOSTED.
 */
export function isPrivateAgentRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.SUPERCHECK_RUNTIME_MODE === 'private-agent';
}

/** Cloud production worker: strict, fail-fast configuration applies. */
export function isCloudWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.NODE_ENV === 'production' &&
    !isSelfHostedEnvironment(env) &&
    !isPrivateAgentRuntime(env)
  );
}

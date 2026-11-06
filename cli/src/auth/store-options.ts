import type Conf from 'conf'

export type AuthData = {
  token?: string
  baseUrl?: string
  organization?: string
  project?: string
}

/**
 * Local credential store using `conf`.
 *
 * SECURITY NOTE: The key below is a static obfuscation key — it prevents
 * casual inspection of the JSON file on disk but does NOT provide real
 * encryption against a determined attacker with file access.
 * For CI/CD and production use, prefer the SUPERCHECK_TOKEN environment
 * variable which bypasses the local store entirely.
 *
 * The `conf` library requires the parameter name `encryptionKey` — it is
 * NOT true encryption in this usage because the key is static and public.
 */
export const authConfOptions: ConstructorParameters<typeof Conf<AuthData>>[0] = {
  projectName: 'supercheck-cli',
  schema: {
    token: { type: 'string' },
    baseUrl: { type: 'string' },
    organization: { type: 'string' },
    project: { type: 'string' },
  },
  // Static obfuscation key — see SECURITY NOTE above.
  encryptionKey: 'supercheck-cli-v1',
  // The file holds a bearer credential: owner read/write only (rewritten atomically on every save).
  configFileMode: 0o600,
}

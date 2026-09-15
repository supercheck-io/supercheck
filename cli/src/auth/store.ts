import Conf from 'conf'
import { AuthenticationError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

const TOKEN_PREFIX_LIVE = 'sck_live_'
const TOKEN_PREFIX_TEST = 'sck_test_'
const TOKEN_PREFIX_TRIGGER = 'sck_trigger_'
const TOKEN_PREFIX_TRIGGER_LEGACY = 'job_'

const VALID_CLI_PREFIXES = [TOKEN_PREFIX_LIVE, TOKEN_PREFIX_TEST]
const VALID_TRIGGER_PREFIXES = [TOKEN_PREFIX_TRIGGER, TOKEN_PREFIX_TRIGGER_LEGACY]

interface AuthData {
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
const store = new Conf<AuthData>({
  projectName: 'supercheck-cli',
  schema: {
    token: { type: 'string' },
    baseUrl: { type: 'string' },
    organization: { type: 'string' },
    project: { type: 'string' },
  },
  // Static obfuscation key — see SECURITY NOTE above.
  encryptionKey: 'supercheck-cli-v1',
})

/**
 * Validate that a token has a recognized prefix.
 */
export function validateTokenFormat(token: string): boolean {
  return VALID_CLI_PREFIXES.some((prefix) => token.startsWith(prefix))
}

export function validateTriggerKeyFormat(token: string): boolean {
  return VALID_TRIGGER_PREFIXES.some((prefix) => token.startsWith(prefix))
}

/**
 * Get the current authentication token.
 * Priority: env var > stored token
 */
export function getToken(): string | null {
  const envToken = process.env.SUPERCHECK_TOKEN
  if (envToken) {
    const trimmed = envToken.trim()
    if (!validateTokenFormat(trimmed)) {
      logger.warn('SUPERCHECK_TOKEN must be a CLI token (sck_live_* or sck_test_*).')
      return null
    }
    return trimmed
  }

  const stored = store.get('token')
  if (!stored) return null
  return validateTokenFormat(stored) ? stored : null
}

export function getTriggerKey(): string | null {
  const envKey = process.env.SUPERCHECK_TRIGGER_KEY
  if (envKey) {
    const trimmed = envKey.trim()
    if (!validateTriggerKeyFormat(trimmed)) {
      logger.warn('SUPERCHECK_TRIGGER_KEY must start with sck_trigger_ or job_.')
      return null
    }
    return trimmed
  }

  // Backward-compatible fallback: allow using SUPERCHECK_TOKEN as a trigger key
  // only if it matches a trigger key prefix.
  const token = process.env.SUPERCHECK_TOKEN
  if (token && validateTriggerKeyFormat(token.trim())) {
    logger.warn('Using SUPERCHECK_TOKEN as a trigger key. Prefer setting SUPERCHECK_TRIGGER_KEY instead.')
    return token.trim()
  }

  return null
}

/**
 * Store a token after validation.
 */
export function setToken(token: string): void {
  if (!validateTokenFormat(token)) {
    throw new AuthenticationError(
      `Invalid token format. Token must start with one of: ${VALID_CLI_PREFIXES.join(', ')}`,
    )
  }
  store.set('token', token)
}

/**
 * Remove stored credentials.
 */
export function clearAuth(): void {
  store.delete('token')
  store.delete('baseUrl')
  store.delete('organization')
  store.delete('project')
}

/**
 * Get the stored base URL override.
 */
export function getStoredBaseUrl(): string | null {
  return process.env.SUPERCHECK_URL ?? store.get('baseUrl') ?? null
}

/**
 * Store a base URL for self-hosted instances.
 */
export function setBaseUrl(url: string): void {
  store.set('baseUrl', url)
}

/**
 * Get the stored organization context.
 */
export function getStoredOrganization(): string | null {
  return process.env.SUPERCHECK_ORG ?? store.get('organization') ?? null
}

/**
 * Store the active organization.
 */
export function setOrganization(org: string): void {
  store.set('organization', org)
}

/**
 * Get the stored project context.
 */
export function getStoredProject(): string | null {
  return process.env.SUPERCHECK_PROJECT ?? store.get('project') ?? null
}

/**
 * Store the active project.
 */
export function setProject(project: string): void {
  store.set('project', project)
}

/**
 * Check if authenticated (token is available).
 */
export function isAuthenticated(): boolean {
  return getToken() !== null
}

/**
 * Require authentication — throw if no token available.
 */
export function requireAuth(): string {
  const token = getToken()
  if (!token) {
    throw new AuthenticationError(
      'Not authenticated. Run `supercheck login` or set SUPERCHECK_TOKEN environment variable.',
    )
  }
  return token
}

export function requireTriggerKey(): string {
  const key = getTriggerKey()
  if (!key) {
    throw new AuthenticationError(
      'Missing trigger key. Set SUPERCHECK_TRIGGER_KEY (sck_trigger_* or job_*) to use `supercheck job trigger`.',
    )
  }
  return key
}

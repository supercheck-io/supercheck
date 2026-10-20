import { config as loadDotenv } from 'dotenv'
import { logger } from '../utils/logger.js'

/**
 * A repository's `.env` is untrusted input: anyone can commit one. It must never decide who the CLI
 * authenticates as, where that credential is sent, or how the connection is protected. Those settings are read
 * only from the real environment (CI secret store, shell) or the stored login.
 *
 * Matching is by pattern and case-insensitive (environment names are case-insensitive on Windows, and the CLI
 * itself reads both `HTTPS_PROXY` and `https_proxy`), so new variants do not need a list update.
 */
const PROTECTED_EXACT = new Set([
  'SUPERCHECK_TOKEN', 'SUPERCHECK_URL', 'SUPERCHECK_TRIGGER_KEY',
  // TLS and process startup: a .env must not weaken certificate checks or inject code into child processes.
  'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR',
])
/** Any proxy setting (HTTP_PROXY, https_proxy, ALL_PROXY, NO_PROXY, ...) and dotenv's own control variables. */
const PROTECTED_PATTERN = /(^|_)PROXY$|^DOTENV_/

export function isProtectedEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  return PROTECTED_EXACT.has(upper) || PROTECTED_PATTERN.test(upper)
}

/** Names already reported, so a command that loads the .env more than once warns only once. */
const warned = new Set<string>()

/**
 * Loads a project `.env` without ever applying protected variables. Existing environment values always win,
 * as with plain dotenv. Returns the protected names the file tried to set (and that were ignored).
 */
export function loadProjectEnv(path?: string): string[] {
  const parsed: Record<string, string> = {}
  // Parse into a private object: nothing touches process.env until it has been filtered.
  loadDotenv({ ...(path ? { path } : {}), quiet: true, processEnv: parsed })
  const ignored: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (isProtectedEnvName(key)) {
      if (process.env[key] === undefined) ignored.push(key)
      continue
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
  const fresh = ignored.filter((key) => !warned.has(key))
  fresh.forEach((key) => warned.add(key))
  if (fresh.length > 0) {
    logger.warn(`Ignoring ${fresh.join(', ')} from .env: credentials, API targets and network/TLS settings are only read from the real environment or a stored login. Export them in your shell, run \`supercheck login\`, or use your CI secret store.`)
  }
  return ignored
}

import { config as loadDotenv } from 'dotenv'
import { logger } from '../utils/logger.js'

/**
 * Variables that decide who the CLI authenticates as and where it sends that credential. A repository's
 * `.env` is untrusted input: it may be committed by anyone, so it must never supply these. They are read
 * only from the real environment (CI secret store, shell) or the stored login.
 */
export const PROTECTED_ENV = ['SUPERCHECK_TOKEN', 'SUPERCHECK_URL', 'SUPERCHECK_TRIGGER_KEY'] as const

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
    if ((PROTECTED_ENV as readonly string[]).includes(key)) {
      if (process.env[key] === undefined) ignored.push(key)
      continue
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
  if (ignored.length > 0) {
    logger.warn(`Ignoring ${ignored.join(', ')} from .env: credentials and API targets are only read from the real environment or a stored login. Export them in your shell, run \`supercheck login\`, or use your CI secret store.`)
  }
  return ignored
}

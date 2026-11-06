import Conf from 'conf'
import { renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from '../utils/logger.js'
import { ConfigurationError } from '../utils/errors.js'

type Options<T extends Record<string, unknown>> = ConstructorParameters<typeof Conf<T>>[0]

/** Where conf keeps this file; a probe store (no encryption or schema, so it cannot fail) reveals the directory. */
function configFilePath<T extends Record<string, unknown>>(options: Options<T>): string {
  const probe = new Conf<Record<string, unknown>>({ projectName: options?.projectName, projectSuffix: options?.projectSuffix, cwd: options?.cwd, configName: '__path-probe' })
  return join(dirname(probe.path), `${options?.configName ?? 'config'}.${options?.fileExtension ?? 'json'}`)
}

/**
 * Open a conf file without letting a corrupt one crash every command at import time.
 * An unreadable file (bad JSON, wrong key, schema violation) is moved aside to `<file>.corrupt-<timestamp>`
 * (never deleted) and a fresh one is started, with a warning naming the backup.
 */
export function openConf<T extends Record<string, unknown>>(options: Options<T>): Conf<T> {
  try {
    return new Conf<T>(options)
  } catch (error) {
    const path = configFilePath(options)
    const backup = `${path}.corrupt-${Date.now()}`
    try { renameSync(path, backup) } catch {
      throw new ConfigurationError(`Config file ${path} is unreadable (${error instanceof Error ? error.message : String(error)}) and could not be moved aside. Fix or remove it.`)
    }
    logger.warn(`Config file ${path} was unreadable (${error instanceof Error ? error.message : String(error)}). It was moved to ${backup}; run \`supercheck login\` again.`)
    return new Conf<T>(options)
  }
}

import Conf from 'conf'
import { logger } from '../utils/logger.js'

/**
 * Open a conf file without letting a corrupt one crash every command at import time.
 * An unreadable file (bad JSON, wrong key, schema violation) is reset with a warning naming it.
 */
export function openConf<T extends Record<string, unknown>>(options: ConstructorParameters<typeof Conf<T>>[0]): Conf<T> {
  try {
    return new Conf<T>(options)
  } catch (error) {
    const conf = new Conf<T>({ ...options, clearInvalidConfig: true })
    logger.warn(`Reset unreadable config file ${conf.path} (${error instanceof Error ? error.message : String(error)}). Run \`supercheck login\` again.`)
    return conf
  }
}

import pc from 'picocolors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

let currentLevel: LogLevel = 'info'
let quietMode = false

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function setQuietMode(quiet: boolean): void {
  quietMode = quiet
  if (quiet) currentLevel = 'error'
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.error(pc.gray(`[debug] ${message}`), ...args)
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info') && !quietMode) {
      console.error(message, ...args)
    }
  },

  success(message: string, ...args: unknown[]): void {
    if (shouldLog('info') && !quietMode) {
      console.error(pc.green(`✓ ${message}`), ...args)
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.error(pc.yellow(`⚠ ${message}`), ...args)
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(pc.red(`✗ ${message}`), ...args)
    }
  },

  /**
   * Output data to stdout (not stderr).
   * This is for machine-readable output (JSON, tables).
   */
  output(data: string): void {
    console.log(data)
  },

  newline(): void {
    if (!quietMode) console.error('')
  },

  /**
   * Print a styled header.
   */
  header(text: string): void {
    if (!quietMode) {
      console.error(pc.bold(pc.cyan(text)))
    }
  },
}

import { redact, redactText } from './redact.js'
import pc from './colors.js'

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
let machineMode = false
let outputCount = 0
export function setMachineMode(value: boolean): void { machineMode = value; outputCount = 0 }
export function getOutputCount(): number { return outputCount }

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
      console.error(pc.gray(`[debug] ${redactText(message)}`), ...args.map((arg) => redact(arg)))
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info') && !quietMode) {
      console.error(redactText(message), ...args.map((arg) => redact(arg)))
    }
  },

  success(message: string, ...args: unknown[]): void {
    if (shouldLog('info') && !quietMode) {
      console.error(pc.green(`✓ ${redactText(message)}`), ...args.map((arg) => redact(arg)))
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.error(pc.yellow(`⚠ ${redactText(message)}`), ...args.map((arg) => redact(arg)))
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(pc.red(`✗ ${redactText(message)}`), ...args.map((arg) => redact(arg)))
    }
  },

  /**
   * Output data to stdout (not stderr).
   * This is for machine-readable output (JSON, tables).
   */
  output(data: string, options: { redact?: boolean } = {}): void {
    outputCount++
    if (machineMode && options.redact !== false) {
      try { data = JSON.stringify(redact(JSON.parse(data))) } catch { data = redactText(data) }
    }
    process.stdout.write(`${machineMode || options.redact === false ? data : redactText(data)}\n`)
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

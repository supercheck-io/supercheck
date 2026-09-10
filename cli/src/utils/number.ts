import { CLIError, ExitCode } from './errors.js'

/**
 * Parse a string to an integer with strict validation.
 */
export function parseIntStrict(
  value: string,
  name: string,
  opts?: { min?: number; max?: number },
): number {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    throw new CLIError(
      `Invalid value for ${name}: "${value}" is not a valid integer.`,
      ExitCode.ConfigError,
    )
  }
  if (opts?.min !== undefined && parsed < opts.min) {
    throw new CLIError(
      `Invalid value for ${name}: ${parsed} is below the minimum of ${opts.min}.`,
      ExitCode.ConfigError,
    )
  }
  if (opts?.max !== undefined && parsed > opts.max) {
    throw new CLIError(
      `Invalid value for ${name}: ${parsed} exceeds the maximum of ${opts.max}.`,
      ExitCode.ConfigError,
    )
  }
  return parsed
}

/**
 * Parse a string boolean strictly.
 * Accepts only true/false (case-insensitive) to avoid silently coercing typos.
 */
export function parseBooleanStrict(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase()

  if (normalized === 'true') return true
  if (normalized === 'false') return false

  throw new CLIError(
    `Invalid value for ${name}: "${value}" is not a valid boolean. Expected "true" or "false".`,
    ExitCode.ConfigError,
  )
}

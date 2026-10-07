/**
 * Standard CLI exit codes.
 *
 * 0 — Success
 * 1 — General error
 * 2 — Authentication error
 * 3 — Configuration error
 * 4 — Network / API error
 * 5 — Timeout
 */
export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  AuthError = 2,
  ConfigError = 3,
  ApiError = 4,
  Timeout = 5,
  Interrupted = 130,
}

export class CLIError extends Error {
  public readonly exitCode: ExitCode

  constructor(message: string, exitCode: ExitCode = ExitCode.GeneralError) {
    super(message)
    this.name = 'CLIError'
    this.exitCode = exitCode
  }
}

export class AuthenticationError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.AuthError)
    this.name = 'AuthenticationError'
  }
}

export class ConfigurationError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.ConfigError)
    this.name = 'ConfigurationError'
  }
}

export class ApiRequestError extends CLIError {
  public readonly statusCode?: number
  public readonly responseBody?: unknown

  constructor(message: string, statusCode?: number, responseBody?: unknown) {
    super(message, ExitCode.ApiError)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

export class TimeoutError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.Timeout)
    this.name = 'TimeoutError'
  }
}

export class ConfigNotFoundError extends CLIError {
  constructor(message: string = 'No supercheck.config.ts found. Run `supercheck init` to create one.') {
    super(message, ExitCode.ConfigError)
    this.name = 'ConfigNotFoundError'
  }
}

/** Keep network diagnostics useful without copying addresses or request credentials. */
export function networkErrorMessage(error: unknown): string {
  const codes = new Set<string>()
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 5) return
    const record = value as { code?: unknown; cause?: unknown; errors?: unknown[] }
    if (typeof record.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(record.code)) codes.add(record.code)
    visit(record.cause, depth + 1)
    if (Array.isArray(record.errors)) for (const child of record.errors) visit(child, depth + 1)
  }
  visit(error)
  const message = error instanceof Error ? error.message : String(error)
  return codes.size ? `${message} (${[...codes].join(', ')})` : message
}

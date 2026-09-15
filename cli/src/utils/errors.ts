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

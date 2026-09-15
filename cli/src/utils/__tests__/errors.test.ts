/**
 * CLI Errors Unit Tests
 *
 * Tests for error classes and exit codes covering:
 * - ExitCode enum values
 * - CLIError base class
 * - Specialized error classes
 * - Error inheritance
 */

import {
  ExitCode,
  CLIError,
  AuthenticationError,
  ConfigurationError,
  ApiRequestError,
  TimeoutError,
} from '../errors.js'
import { describe, it, expect } from '@jest/globals'

describe('ExitCode', () => {
  it('should have correct numeric values', () => {
    expect(ExitCode.Success).toBe(0)
    expect(ExitCode.GeneralError).toBe(1)
    expect(ExitCode.AuthError).toBe(2)
    expect(ExitCode.ConfigError).toBe(3)
    expect(ExitCode.ApiError).toBe(4)
    expect(ExitCode.Timeout).toBe(5)
  })
})

describe('CLIError', () => {
  it('should create error with message and default exit code', () => {
    const error = new CLIError('Something went wrong')

    expect(error.message).toBe('Something went wrong')
    expect(error.exitCode).toBe(ExitCode.GeneralError)
    expect(error.name).toBe('CLIError')
  })

  it('should create error with custom exit code', () => {
    const error = new CLIError('Config issue', ExitCode.ConfigError)

    expect(error.message).toBe('Config issue')
    expect(error.exitCode).toBe(ExitCode.ConfigError)
  })

  it('should extend Error', () => {
    const error = new CLIError('Test')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('AuthenticationError', () => {
  it('should create error with AuthError exit code', () => {
    const error = new AuthenticationError('Not logged in')

    expect(error.message).toBe('Not logged in')
    expect(error.exitCode).toBe(ExitCode.AuthError)
    expect(error.name).toBe('AuthenticationError')
  })

  it('should extend CLIError', () => {
    const error = new AuthenticationError('Test')
    expect(error).toBeInstanceOf(CLIError)
  })
})

describe('ConfigurationError', () => {
  it('should create error with ConfigError exit code', () => {
    const error = new ConfigurationError('Invalid config file')

    expect(error.message).toBe('Invalid config file')
    expect(error.exitCode).toBe(ExitCode.ConfigError)
    expect(error.name).toBe('ConfigurationError')
  })

  it('should extend CLIError', () => {
    const error = new ConfigurationError('Test')
    expect(error).toBeInstanceOf(CLIError)
  })
})

describe('ApiRequestError', () => {
  it('should create error with ApiError exit code', () => {
    const error = new ApiRequestError('Request failed')

    expect(error.message).toBe('Request failed')
    expect(error.exitCode).toBe(ExitCode.ApiError)
    expect(error.name).toBe('ApiRequestError')
  })

  it('should include status code when provided', () => {
    const error = new ApiRequestError('Not found', 404)

    expect(error.statusCode).toBe(404)
  })

  it('should include response body when provided', () => {
    const responseBody = { error: 'Invalid input', field: 'name' }
    const error = new ApiRequestError('Validation failed', 400, responseBody)

    expect(error.responseBody).toEqual(responseBody)
  })

  it('should handle undefined optional parameters', () => {
    const error = new ApiRequestError('Generic error')

    expect(error.statusCode).toBeUndefined()
    expect(error.responseBody).toBeUndefined()
  })

  it('should extend CLIError', () => {
    const error = new ApiRequestError('Test')
    expect(error).toBeInstanceOf(CLIError)
  })
})

describe('TimeoutError', () => {
  it('should create error with Timeout exit code', () => {
    const error = new TimeoutError('Request timed out')

    expect(error.message).toBe('Request timed out')
    expect(error.exitCode).toBe(ExitCode.Timeout)
    expect(error.name).toBe('TimeoutError')
  })

  it('should extend CLIError', () => {
    const error = new TimeoutError('Test')
    expect(error).toBeInstanceOf(CLIError)
  })
})

describe('Error hierarchy', () => {
  it('all specialized errors should be catchable as CLIError', () => {
    const errors = [
      new AuthenticationError('Auth'),
      new ConfigurationError('Config'),
      new ApiRequestError('API'),
      new TimeoutError('Timeout'),
    ]

    errors.forEach((error) => {
      expect(error).toBeInstanceOf(CLIError)
      expect(error).toBeInstanceOf(Error)
    })
  })

  it('errors should have correct names for logging', () => {
    expect(new AuthenticationError('').name).toBe('AuthenticationError')
    expect(new ConfigurationError('').name).toBe('ConfigurationError')
    expect(new ApiRequestError('').name).toBe('ApiRequestError')
    expect(new TimeoutError('').name).toBe('TimeoutError')
  })
})

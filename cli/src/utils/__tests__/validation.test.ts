/**
 * Validation Utility Unit Tests
 *
 * Tests for parseIntStrict covering:
 * - Valid integer parsing
 * - NaN rejection
 * - Min/max constraint enforcement
 * - Clear error messages
 */

import { describe, it, expect } from '@jest/globals'
import { parseBooleanStrict, parseIntStrict } from '../number.js'
import { CLIError, ExitCode } from '../errors.js'
import { isK6Script, validateScriptTypeMatch, normalizeTestTypeForApi } from '../validation.js'

describe('parseIntStrict', () => {
  describe('valid inputs', () => {
    it('should parse a valid positive integer', () => {
      expect(parseIntStrict('42', '--timeout')).toBe(42)
    })

    it('should parse zero', () => {
      expect(parseIntStrict('0', '--retries')).toBe(0)
    })

    it('should parse negative integers', () => {
      expect(parseIntStrict('-5', '--offset')).toBe(-5)
    })

    it('should parse large integers', () => {
      expect(parseIntStrict('86400', '--timeout')).toBe(86400)
    })

    it('should parse integers with leading whitespace (parseInt behavior)', () => {
      expect(parseIntStrict('  100', '--value')).toBe(100)
    })
  })

  describe('invalid inputs', () => {
    it('should throw CLIError for non-numeric strings', () => {
      expect(() => parseIntStrict('abc', '--timeout')).toThrow(CLIError)
    })

    it('should throw CLIError for empty string', () => {
      expect(() => parseIntStrict('', '--timeout')).toThrow(CLIError)
    })

    it('should throw with ConfigError exit code', () => {
      try {
        parseIntStrict('abc', '--timeout')
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError)
        expect((err as CLIError).exitCode).toBe(ExitCode.ConfigError)
      }
    })

    it('should include the option name in error message', () => {
      expect(() => parseIntStrict('xyz', '--expires-in')).toThrow(/--expires-in/)
    })

    it('should include the invalid value in error message', () => {
      expect(() => parseIntStrict('xyz', '--timeout')).toThrow(/"xyz"/)
    })
  })

  describe('min constraint', () => {
    it('should accept values at the minimum', () => {
      expect(parseIntStrict('60', '--expires-in', { min: 60 })).toBe(60)
    })

    it('should accept values above the minimum', () => {
      expect(parseIntStrict('120', '--expires-in', { min: 60 })).toBe(120)
    })

    it('should throw for values below the minimum', () => {
      expect(() => parseIntStrict('30', '--expires-in', { min: 60 })).toThrow(/below the minimum/)
    })

    it('should include the minimum value in error message', () => {
      expect(() => parseIntStrict('0', '--timeout', { min: 1 })).toThrow(/minimum of 1/)
    })
  })

  describe('max constraint', () => {
    it('should accept values at the maximum', () => {
      expect(parseIntStrict('100', '--retries', { max: 100 })).toBe(100)
    })

    it('should accept values below the maximum', () => {
      expect(parseIntStrict('50', '--retries', { max: 100 })).toBe(50)
    })

    it('should throw for values above the maximum', () => {
      expect(() => parseIntStrict('200', '--retries', { max: 100 })).toThrow(/exceeds the maximum/)
    })
  })

  describe('combined constraints', () => {
    it('should accept values within range', () => {
      expect(parseIntStrict('60', '--expires-in', { min: 60, max: 86400 })).toBe(60)
    })

    it('should reject values below min in combined constraints', () => {
      expect(() => parseIntStrict('1', '--expires-in', { min: 60, max: 86400 })).toThrow(/below the minimum/)
    })

    it('should reject values above max in combined constraints', () => {
      expect(() => parseIntStrict('100000', '--expires-in', { min: 60, max: 86400 })).toThrow(/exceeds the maximum/)
    })
  })
})

describe('parseBooleanStrict', () => {
  it('should parse true values', () => {
    expect(parseBooleanStrict('true', '--active')).toBe(true)
    expect(parseBooleanStrict(' TRUE ', '--active')).toBe(true)
  })

  it('should parse false values', () => {
    expect(parseBooleanStrict('false', '--active')).toBe(false)
    expect(parseBooleanStrict(' False ', '--active')).toBe(false)
  })

  it('should reject invalid boolean strings', () => {
    expect(() => parseBooleanStrict('yes', '--active')).toThrow(CLIError)
    expect(() => parseBooleanStrict('1', '--active')).toThrow(/Expected "true" or "false"/)
  })
})

describe('script type validation helpers', () => {
  const k6Script = "import http from 'k6/http'\nexport default function() { http.get('https://example.com') }"
  const playwrightScript = "import { test } from '@playwright/test'\ntest('ok', async ({ page }) => { await page.goto('https://example.com') })"

  it('detects k6 scripts by import pattern', () => {
    expect(isK6Script(k6Script)).toBe(true)
    expect(isK6Script(playwrightScript)).toBe(false)
  })

  it('rejects k6 script declared as browser type', () => {
    const error = validateScriptTypeMatch(k6Script, 'browser')
    expect(error).toContain('k6 imports')
    expect(error).toContain('performance')
  })

  it('rejects non-k6 script declared as performance type', () => {
    const error = validateScriptTypeMatch(playwrightScript, 'performance')
    expect(error).toContain('does not contain k6 imports')
  })

  it('accepts matching script/type combinations', () => {
    expect(validateScriptTypeMatch(k6Script, 'performance')).toBeUndefined()
    expect(validateScriptTypeMatch(playwrightScript, 'browser')).toBeUndefined()
  })

  it('normalizes local type aliases to API types', () => {
    expect(normalizeTestTypeForApi('playwright')).toBe('browser')
    expect(normalizeTestTypeForApi('k6')).toBe('performance')
    expect(normalizeTestTypeForApi('load')).toBe('performance')
    expect(normalizeTestTypeForApi('api')).toBe('api')
    expect(normalizeTestTypeForApi('unknown')).toBeUndefined()
  })
})

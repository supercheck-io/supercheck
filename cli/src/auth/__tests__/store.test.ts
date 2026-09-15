/**
 * Auth Store Unit Tests
 *
 * Tests for token storage and retrieval covering:
 * - Token validation format
 * - Environment variable priority
 * - Local storage operations
 * - Authentication state checks
 */

import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals'
import { AuthenticationError } from '../../utils/errors.js'

// Mock the Conf store with a simple in-memory implementation
const mockStore = new Map<string, string>()

jest.unstable_mockModule('conf', () => ({
  default: jest.fn().mockImplementation(() => ({
    get: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    delete: (key: string) => mockStore.delete(key),
  })),
}))

// Mock logger
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Dynamic import after mocking
const {
  validateTokenFormat,
  validateTriggerKeyFormat,
  getToken,
  getTriggerKey,
  setToken,
  clearAuth,
  getStoredBaseUrl,
  setBaseUrl,
  getStoredOrganization,
  setOrganization,
  getStoredProject,
  setProject,
  isAuthenticated,
  requireAuth,
  requireTriggerKey,
} = await import('../store.js')

describe('Auth Store', () => {
  // Store original env vars
  const originalEnv = { ...process.env }

  beforeEach(() => {
    mockStore.clear()
    // Reset environment variables
    delete process.env.SUPERCHECK_TOKEN
    delete process.env.SUPERCHECK_TRIGGER_KEY
    delete process.env.SUPERCHECK_URL
    delete process.env.SUPERCHECK_ORG
    delete process.env.SUPERCHECK_PROJECT
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('validateTokenFormat', () => {
    it('should accept sck_live_ prefixed tokens', () => {
      expect(validateTokenFormat('sck_live_abc123def456')).toBe(true)
    })

    it('should accept sck_test_ prefixed tokens', () => {
      expect(validateTokenFormat('sck_test_abc123def456')).toBe(true)
    })

    it('should reject trigger keys', () => {
      expect(validateTokenFormat('sck_trigger_abc123def456')).toBe(false)
      expect(validateTokenFormat('job_abc123def456')).toBe(false)
    })

    it('should reject tokens without valid prefix', () => {
      expect(validateTokenFormat('invalid_token')).toBe(false)
      expect(validateTokenFormat('sk_live_abc123')).toBe(false)
      expect(validateTokenFormat('job_abc123')).toBe(false)
      expect(validateTokenFormat('')).toBe(false)
    })

    it('should reject empty tokens', () => {
      expect(validateTokenFormat('')).toBe(false)
    })
  })

  describe('validateTriggerKeyFormat', () => {
    it('should accept sck_trigger_ prefixed keys', () => {
      expect(validateTriggerKeyFormat('sck_trigger_abc123def456')).toBe(true)
    })

    it('should accept legacy job_ prefixed keys', () => {
      expect(validateTriggerKeyFormat('job_abc123def456')).toBe(true)
    })

    it('should reject CLI tokens', () => {
      expect(validateTriggerKeyFormat('sck_live_abc123def456')).toBe(false)
      expect(validateTriggerKeyFormat('sck_test_abc123def456')).toBe(false)
    })
  })

  describe('getToken', () => {
    it('should return env var token when set', () => {
      process.env.SUPERCHECK_TOKEN = 'sck_live_envtoken'
      expect(getToken()).toBe('sck_live_envtoken')
    })

    it('should return null when env var is a trigger key', () => {
      process.env.SUPERCHECK_TOKEN = 'sck_trigger_envtoken'
      expect(getToken()).toBeNull()
    })

    it('should return stored token when env var is not set', () => {
      mockStore.set('token', 'sck_live_storedtoken')
      expect(getToken()).toBe('sck_live_storedtoken')
    })

    it('should prioritize env var over stored token', () => {
      process.env.SUPERCHECK_TOKEN = 'sck_live_envtoken'
      mockStore.set('token', 'sck_live_storedtoken')
      expect(getToken()).toBe('sck_live_envtoken')
    })

    it('should return null when no token available', () => {
      expect(getToken()).toBeNull()
    })
  })

  describe('getTriggerKey', () => {
    it('should return trigger key when SUPERCHECK_TRIGGER_KEY is set', () => {
      process.env.SUPERCHECK_TRIGGER_KEY = 'sck_trigger_envkey'
      expect(getTriggerKey()).toBe('sck_trigger_envkey')
    })

    it('should accept legacy job_ key', () => {
      process.env.SUPERCHECK_TRIGGER_KEY = 'job_envkey'
      expect(getTriggerKey()).toBe('job_envkey')
    })

    it('should fall back to SUPERCHECK_TOKEN when it contains a trigger key', () => {
      process.env.SUPERCHECK_TOKEN = 'job_envkey'
      expect(getTriggerKey()).toBe('job_envkey')
    })

    it('should return null when no trigger key available', () => {
      expect(getTriggerKey()).toBeNull()
    })
  })

  describe('setToken', () => {
    it('should store valid token', () => {
      setToken('sck_live_validtoken')
      expect(mockStore.get('token')).toBe('sck_live_validtoken')
    })

    it('should throw AuthenticationError for invalid token format', () => {
      expect(() => setToken('invalid_token')).toThrow(AuthenticationError)
    })

    it('should throw with helpful error message', () => {
      expect(() => setToken('bad_token')).toThrow(/Invalid token format/)
    })
  })

  describe('clearAuth', () => {
    it('should clear all auth-related data', () => {
      mockStore.set('token', 'sck_live_token')
      mockStore.set('baseUrl', 'https://custom.example.com')
      mockStore.set('organization', 'org-123')
      mockStore.set('project', 'proj-456')

      clearAuth()

      expect(mockStore.get('token')).toBeUndefined()
      expect(mockStore.get('baseUrl')).toBeUndefined()
      expect(mockStore.get('organization')).toBeUndefined()
      expect(mockStore.get('project')).toBeUndefined()
    })
  })

  describe('getStoredBaseUrl', () => {
    it('should return env var when set', () => {
      process.env.SUPERCHECK_URL = 'https://env.example.com'
      expect(getStoredBaseUrl()).toBe('https://env.example.com')
    })

    it('should return stored value when env var not set', () => {
      mockStore.set('baseUrl', 'https://stored.example.com')
      expect(getStoredBaseUrl()).toBe('https://stored.example.com')
    })

    it('should return null when neither is set', () => {
      expect(getStoredBaseUrl()).toBeNull()
    })
  })

  describe('setBaseUrl', () => {
    it('should store base URL', () => {
      setBaseUrl('https://custom.example.com')
      expect(mockStore.get('baseUrl')).toBe('https://custom.example.com')
    })
  })

  describe('getStoredOrganization', () => {
    it('should return env var when set', () => {
      process.env.SUPERCHECK_ORG = 'env-org'
      expect(getStoredOrganization()).toBe('env-org')
    })

    it('should return stored value when env var not set', () => {
      mockStore.set('organization', 'stored-org')
      expect(getStoredOrganization()).toBe('stored-org')
    })

    it('should return null when neither is set', () => {
      expect(getStoredOrganization()).toBeNull()
    })
  })

  describe('setOrganization', () => {
    it('should store organization', () => {
      setOrganization('my-org')
      expect(mockStore.get('organization')).toBe('my-org')
    })
  })

  describe('getStoredProject', () => {
    it('should return env var when set', () => {
      process.env.SUPERCHECK_PROJECT = 'env-project'
      expect(getStoredProject()).toBe('env-project')
    })

    it('should return stored value when env var not set', () => {
      mockStore.set('project', 'stored-project')
      expect(getStoredProject()).toBe('stored-project')
    })

    it('should return null when neither is set', () => {
      expect(getStoredProject()).toBeNull()
    })
  })

  describe('setProject', () => {
    it('should store project', () => {
      setProject('my-project')
      expect(mockStore.get('project')).toBe('my-project')
    })
  })

  describe('isAuthenticated', () => {
    it('should return true when token is available', () => {
      mockStore.set('token', 'sck_live_token')
      expect(isAuthenticated()).toBe(true)
    })

    it('should return true when env token is set', () => {
      process.env.SUPERCHECK_TOKEN = 'sck_live_envtoken'
      expect(isAuthenticated()).toBe(true)
    })

    it('should return false when no token is available', () => {
      expect(isAuthenticated()).toBe(false)
    })
  })

  describe('requireAuth', () => {
    it('should return token when authenticated', () => {
      mockStore.set('token', 'sck_live_validtoken')
      expect(requireAuth()).toBe('sck_live_validtoken')
    })

    it('should return env token when set', () => {
      process.env.SUPERCHECK_TOKEN = 'sck_live_envtoken'
      expect(requireAuth()).toBe('sck_live_envtoken')
    })

    it('should throw AuthenticationError when not authenticated', () => {
      expect(() => requireAuth()).toThrow(AuthenticationError)
    })

    it('should throw with helpful login message', () => {
      expect(() => requireAuth()).toThrow(/Run `supercheck login`/)
    })
  })

  describe('requireTriggerKey', () => {
    it('should return key when available', () => {
      process.env.SUPERCHECK_TRIGGER_KEY = 'sck_trigger_envkey'
      expect(requireTriggerKey()).toBe('sck_trigger_envkey')
    })

    it('should throw AuthenticationError when missing', () => {
      expect(() => requireTriggerKey()).toThrow(AuthenticationError)
    })
  })
})

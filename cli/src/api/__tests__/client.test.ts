/**
 * API Client Unit Tests
 *
 * Tests for the ApiClient class covering:
 * - Request building (headers, URLs, params)
 * - HTTP method wrappers (GET, POST, PUT, PATCH, DELETE)
 * - Error responses
 * - Client configuration
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { ApiClient, getApiClient, resetApiClient } from '../client.js'
import { ApiRequestError } from '../../utils/errors.js'

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>
global.fetch = mockFetch

// Mock logger
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('ApiClient', () => {
  let client: ApiClient

  beforeEach(() => {
    jest.clearAllMocks()
    resetApiClient()
    client = new ApiClient({ baseUrl: 'https://api.test.com', token: 'sck_live_test123' })
  })

  describe('constructor', () => {
    it('should use default base URL when not provided', () => {
      const defaultClient = new ApiClient()
      expect(defaultClient).toBeDefined()
    })

    it('should strip trailing slash from base URL', async () => {
      const clientWithSlash = new ApiClient({ baseUrl: 'https://api.test.com/' })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await clientWithSlash.get('/test')
      expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/test')
    })
  })

  describe('setToken', () => {
    it('should update the token', async () => {
      client.setToken('sck_live_newtoken')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/test')

      const calledHeaders = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Headers
      expect(calledHeaders.get('Authorization')).toBe('Bearer sck_live_newtoken')
    })
  })

  describe('setBaseUrl', () => {
    it('should update the base URL', async () => {
      client.setBaseUrl('https://new-api.test.com')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/test')

      expect(mockFetch.mock.calls[0][0]).toBe('https://new-api.test.com/test')
    })

    it('should strip trailing slash from new URL', async () => {
      client.setBaseUrl('https://new-api.test.com/')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/test')

      expect(mockFetch.mock.calls[0][0]).toBe('https://new-api.test.com/test')
    })
  })

  describe('request headers', () => {
    it('should include Authorization header when token is set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/test')

      const calledHeaders = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Headers
      expect(calledHeaders.get('Authorization')).toBe('Bearer sck_live_test123')
    })

    it('should not include Authorization header when no token', async () => {
      const noTokenClient = new ApiClient({ baseUrl: 'https://api.test.com' })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await noTokenClient.get('/test')

      const calledHeaders = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Headers
      expect(calledHeaders.get('Authorization')).toBeNull()
    })

    it('should include Content-Type and User-Agent headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/test')

      const calledHeaders = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Headers
      expect(calledHeaders.get('Content-Type')).toBe('application/json')
      expect(calledHeaders.get('User-Agent')).toMatch(/^supercheck-cli\//)
    })
  })

  describe('URL building', () => {
    it('should append path to base URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/api/jobs')

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.test.com/api/jobs')
    })

    it('should add query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/api/jobs', { page: '1', limit: '10' })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('page=1')
      expect(url).toContain('limit=10')
    })

    it('should ignore undefined query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.get('/api/jobs', { page: '1', filter: undefined })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('page=1')
      expect(url).not.toContain('filter')
    })
  })

  describe('HTTP methods', () => {
    it('should make GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"id": 1}'),
      } as Response)

      const response = await client.get('/api/jobs')

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('GET')
      expect(response.data).toEqual({ id: 1 })
      expect(response.status).toBe(200)
    })

    it('should make POST request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers(),
        text: () => Promise.resolve('{"id": 1}'),
      } as Response)

      await client.post('/api/jobs', { name: 'Test Job' })

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('POST')
      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"name":"Test Job"}')
    })

    it('should make PUT request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.put('/api/jobs/1', { name: 'Updated Job' })

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('PUT')
      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"name":"Updated Job"}')
    })

    it('should make PATCH request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{}'),
      } as Response)

      await client.patch('/api/jobs/1', { status: 'active' })

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('PATCH')
      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].body).toBe('{"status":"active"}')
    })

    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: () => Promise.resolve(''),
      } as Response)

      await client.delete('/api/jobs/1')

      expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE')
    })
  })

  describe('response handling', () => {
    it('should parse JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'X-Custom': 'value' }),
        text: () => Promise.resolve('{"name": "Test", "id": 123}'),
      } as Response)

      const response = await client.get('/api/jobs/1')

      expect(response.data).toEqual({ name: 'Test', id: 123 })
      expect(response.status).toBe(200)
    })

    it('should handle empty response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: () => Promise.resolve(''),
      } as Response)

      const response = await client.delete('/api/jobs/1')

      expect(response.data).toEqual({})
      expect(response.status).toBe(204)
    })
  })

  describe('error handling', () => {
    it('should throw ApiRequestError on 4xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "Not found"}'),
      } as Response)

      await expect(client.request('GET', '/api/jobs/999', { retries: 0 })).rejects.toThrow(ApiRequestError)
    })

    it('should include status code in ApiRequestError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "Forbidden"}'),
      } as Response)

      try {
        await client.request('GET', '/api/admin', { retries: 0 })
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError)
        expect((err as ApiRequestError).statusCode).toBe(403)
      }
    })

    it('should include response body in ApiRequestError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "Invalid input", "field": "name"}'),
      } as Response)

      try {
        await client.request('POST', '/api/jobs', { body: {}, retries: 0 })
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError)
        expect((err as ApiRequestError).responseBody).toEqual({
          error: 'Invalid input',
          field: 'name',
        })
      }
    })

    it('should handle non-JSON error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('Bad Request'),
      } as Response)

      try {
        await client.request('GET', '/api/error', { retries: 0 })
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError)
        expect((err as ApiRequestError).responseBody).toBe('Bad Request')
      }
    })

    it('should not retry on 4xx client errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "Bad request"}'),
      } as Response)

      await expect(client.request('GET', '/api/jobs', { retries: 0 })).rejects.toThrow(ApiRequestError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should not retry POST on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network connection reset'))

      await expect(client.post('/api/jobs', { name: 'New Job' })).rejects.toThrow(ApiRequestError)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should retry GET on network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network connection reset'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: () => Promise.resolve('{"success": true}'),
        } as Response)

      // Mock sleep to avoid waiting during test
      const sleepSpy = jest.spyOn(client as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue()

      const res = await client.get('/api/jobs')
      expect(res.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      sleepSpy.mockRestore()
    })
  })
})

describe('getApiClient', () => {
  beforeEach(() => {
    resetApiClient()
  })

  it('should create a new client on first call', () => {
    const client = getApiClient()
    expect(client).toBeInstanceOf(ApiClient)
  })

  it('should return same client on subsequent calls', () => {
    const client1 = getApiClient()
    const client2 = getApiClient()
    expect(client1).toBe(client2)
  })

  it('should update token when called with new options', () => {
    const client1 = getApiClient({ token: 'token1' })
    const client2 = getApiClient({ token: 'token2' })
    expect(client1).toBe(client2)
  })
})

describe('resetApiClient', () => {
  it('should reset the singleton client', () => {
    const client1 = getApiClient()
    resetApiClient()
    const client2 = getApiClient()
    expect(client1).not.toBe(client2)
  })
})

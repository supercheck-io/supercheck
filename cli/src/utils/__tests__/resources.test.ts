/**
 * Resources Utility Unit Tests
 *
 * Tests for resource utility functions covering:
 * - safeTokenPreview edge cases (empty, short, normal tokens)
 * - getApiEndpoint mapping
 * - fetchAllPages pagination logic
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jest, describe, it, expect } from '@jest/globals'
import { safeTokenPreview, getApiEndpoint, fetchAllPages, fetchRemoteResources, buildLocalResources } from '../resources.js'

type PaginatedPayload<T> = {
  data: T[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

type MockGetResponse<T> = {
  data: PaginatedPayload<T>
  status: number
  headers: Headers
}

type MockGet = (
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) => Promise<MockGetResponse<Record<string, unknown>>>

function createPageResponse(
  data: Record<string, unknown>[],
  pagination: PaginatedPayload<Record<string, unknown>>['pagination'],
): MockGetResponse<Record<string, unknown>> {
  return {
    data: { data, pagination },
    status: 200,
    headers: new Headers(),
  }
}

// Mock logger
jest.unstable_mockModule('../logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('safeTokenPreview', () => {
  it('should return "(empty)" for empty string', () => {
    expect(safeTokenPreview('')).toBe('(empty)')
  })

  it('should handle single character token', () => {
    expect(safeTokenPreview('a')).toBe('a***')
  })

  it('should handle 2-char token', () => {
    const result = safeTokenPreview('ab')
    expect(result).toBe('a***')
  })

  it('should handle 4-char token', () => {
    const result = safeTokenPreview('abcd')
    expect(result).toBe('a***')
  })

  it('should handle 5-char token (short, ≤ 8)', () => {
    const result = safeTokenPreview('abcde')
    expect(result).toBe('abcd...')
  })

  it('should handle 8-char token', () => {
    const result = safeTokenPreview('abcdefgh')
    expect(result).toBe('abcd...')
  })

  it('should handle mid-length token (9-20 chars)', () => {
    const result = safeTokenPreview('sck_live_abc')
    // 12 chars, ≤20: substring(0, min(12-4=8, 12)) → first 8 chars + '...'
    expect(result).toBe('sck_live...')
  })

  it('should handle long token with prefix and suffix', () => {
    const result = safeTokenPreview('sck_live_abcdefghijklmnopqrst')
    expect(result).toBe('sck_live_abc...qrst')
  })

  it('should handle standard CLI token format', () => {
    const result = safeTokenPreview('sck_live_0123456789abcdef')
    expect(result.startsWith('sck_live_')).toBe(true)
    expect(result.endsWith('...')).toBe(false) // Long enough for suffix
  })
})

describe('getApiEndpoint', () => {
  it('should map job to /api/jobs', () => {
    expect(getApiEndpoint('job')).toBe('/api/jobs')
  })

  it('should map test to /api/tests', () => {
    expect(getApiEndpoint('test')).toBe('/api/tests')
  })

  it('should map monitor to /api/monitors', () => {
    expect(getApiEndpoint('monitor')).toBe('/api/monitors')
  })

  it('should map variable to /api/variables', () => {
    expect(getApiEndpoint('variable')).toBe('/api/variables')
  })

  it('should map tag to /api/tags', () => {
    expect(getApiEndpoint('tag')).toBe('/api/tags')
  })

  it('should map notificationProvider to /api/notification-providers', () => {
    expect(getApiEndpoint('notificationProvider')).toBe('/api/notification-providers')
  })

  it('should throw for unknown resource type', () => {
    expect(() => getApiEndpoint('unknown')).toThrow(/Unknown resource type/)
  })
})

describe('fetchAllPages', () => {
  it('should fetch single page when totalPages is 1', async () => {
    const getMock = jest.fn<MockGet>()
    getMock.mockResolvedValue(createPageResponse(
      [{ id: '1', name: 'Job 1' }, { id: '2', name: 'Job 2' }],
      { total: 2, page: 1, limit: 200, totalPages: 1, hasNextPage: false, hasPrevPage: false },
    ))

    const mockClient = {
      get: getMock,
    } as unknown as ReturnType<typeof import('../../api/client.js').getApiClient>

    const result = await fetchAllPages(mockClient, '/api/jobs', 'jobs')

    expect(result).toHaveLength(2)
    expect(mockClient.get).toHaveBeenCalledTimes(1)
  })

  it('should fetch all pages when totalPages > 1', async () => {
    const getMock = jest.fn<MockGet>()
    getMock
      .mockResolvedValueOnce(createPageResponse(
        [{ id: '1' }, { id: '2' }],
        { total: 4, page: 1, limit: 2, totalPages: 2, hasNextPage: true, hasPrevPage: false },
      ))
      .mockResolvedValueOnce(createPageResponse(
        [{ id: '3' }, { id: '4' }],
        { total: 4, page: 2, limit: 2, totalPages: 2, hasNextPage: false, hasPrevPage: true },
      ))

    const mockClient = {
      get: getMock,
    } as unknown as ReturnType<typeof import('../../api/client.js').getApiClient>

    const result = await fetchAllPages(mockClient, '/api/jobs', 'jobs')

    expect(result).toHaveLength(4)
    expect(mockClient.get).toHaveBeenCalledTimes(2)
    expect(mockClient.get).toHaveBeenCalledWith('/api/jobs', { limit: '200', page: '1' })
    expect(mockClient.get).toHaveBeenCalledWith('/api/jobs', { limit: '200', page: '2' })
  })

  it('should fetch 3 pages correctly', async () => {
    const getMock = jest.fn<MockGet>()
    getMock
      .mockResolvedValueOnce(createPageResponse(
        Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) })),
        { total: 500, page: 1, limit: 200, totalPages: 3, hasNextPage: true, hasPrevPage: false },
      ))
      .mockResolvedValueOnce(createPageResponse(
        Array.from({ length: 200 }, (_, i) => ({ id: String(i + 201) })),
        { total: 500, page: 2, limit: 200, totalPages: 3, hasNextPage: true, hasPrevPage: true },
      ))
      .mockResolvedValueOnce(createPageResponse(
        Array.from({ length: 100 }, (_, i) => ({ id: String(i + 401) })),
        { total: 500, page: 3, limit: 200, totalPages: 3, hasNextPage: false, hasPrevPage: true },
      ))

    const mockClient = {
      get: getMock,
    } as unknown as ReturnType<typeof import('../../api/client.js').getApiClient>

    const result = await fetchAllPages(mockClient, '/api/tests', 'tests')

    expect(result).toHaveLength(500)
    expect(mockClient.get).toHaveBeenCalledTimes(3)
  })

  it('should propagate API errors', async () => {
    const getMock = jest.fn<MockGet>()
    getMock.mockRejectedValue(new Error('Network error'))

    const mockClient = {
      get: getMock,
    } as unknown as ReturnType<typeof import('../../api/client.js').getApiClient>

    await expect(fetchAllPages(mockClient, '/api/jobs', 'jobs')).rejects.toThrow('Network error')
  })
})

describe('fetchRemoteResources', () => {
  it('normalizes remote test types for reconcile consistency', async () => {
    const getMock = jest.fn<MockGet>().mockImplementation(async (path: string) => {
      if (path === '/api/jobs' || path === '/api/monitors' || path === '/api/status-pages') {
        return createPageResponse(
          [],
          { total: 0, page: 1, limit: 200, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        )
      }

      if (path === '/api/tests?includeScript=true') {
        return createPageResponse(
          [
            { id: 't-1', title: 'API test', type: 'api', script: 'console.log(1)' },
            { id: 't-2', title: 'K6 test', type: 'performance', script: "import http from 'k6/http'" },
          ],
          { total: 2, page: 1, limit: 200, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        )
      }

      if (path === '/api/variables' || path === '/api/tags' || path === '/api/notification-providers') {
        return {
          data: [],
          status: 200,
          headers: new Headers(),
        } as unknown as MockGetResponse<Record<string, unknown>>
      }

      throw new Error(`Unexpected path in test: ${path}`)
    })

    const mockClient = {
      get: getMock,
    } as unknown as ReturnType<typeof import('../../api/client.js').getApiClient>

    const resources = await fetchRemoteResources(mockClient)
    const testResources = resources.filter((resource) => resource.type === 'test')

    expect(testResources).toHaveLength(2)
    const apiTest = testResources.find((resource) => resource.id === 't-1')
    const perfTest = testResources.find((resource) => resource.id === 't-2')

    expect(apiTest?.raw.testType).toBe('playwright')
    expect(apiTest?.raw.type).toBeUndefined()
    expect(perfTest?.raw.testType).toBe('k6')
    expect(perfTest?.raw.type).toBeUndefined()
  })
})

describe('buildLocalResources', () => {
  it('omits runtime-only job status from local definitions', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'supercheck-resources-'))
    const resources = buildLocalResources({
      schemaVersion: '1.0',
      project: {
        organization: 'org-1',
        project: 'proj-1',
      },
      jobs: [
        {
          id: '01912345-abcd-7000-8000-000000000001',
          name: 'Nightly',
          tests: ['01912345-abcd-7000-8000-000000000010'],
          status: 'paused',
        },
      ],
    }, cwd)

    expect(resources).toHaveLength(1)
    expect(resources[0]?.type).toBe('job')
    expect(resources[0]?.definition.status).toBeUndefined()
  })
})

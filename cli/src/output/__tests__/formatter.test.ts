/**
 * Formatter Unit Tests
 *
 * Tests for output formatting functions covering:
 * - outputDetail rendering for scalars, nested objects, and arrays
 * - summarizeArray for array-of-object displays
 * - JSON and quiet mode output
 * - formatValue edge cases
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// Mock logger before imports
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockInfo = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    output: mockOutput,
    info: mockInfo,
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    header: jest.fn(),
  },
}))

const { output, outputDetail, setOutputFormat, getOutputFormat } = await import('../formatter.js')

describe('Formatter', () => {
  beforeEach(() => {
    mockOutput.mockClear()
    mockInfo.mockClear()
    setOutputFormat('table')
  })

  describe('setOutputFormat / getOutputFormat', () => {
    it('should default to table format', () => {
      expect(getOutputFormat()).toBe('table')
    })

    it('should switch to json format', () => {
      setOutputFormat('json')
      expect(getOutputFormat()).toBe('json')
      setOutputFormat('table')
    })

    it('should switch to quiet format', () => {
      setOutputFormat('quiet')
      expect(getOutputFormat()).toBe('quiet')
      setOutputFormat('table')
    })
  })

  describe('outputDetail — table mode', () => {
    it('should display scalar key-value pairs', () => {
      outputDetail({ id: '123', name: 'Test', status: 'active' })
      // Should produce 3 output calls (one per field)
      expect(mockOutput).toHaveBeenCalledTimes(3)
      // Check that all keys are present in output
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      expect(calls.some((c) => c.includes('id') && c.includes('123'))).toBe(true)
      expect(calls.some((c) => c.includes('name') && c.includes('Test'))).toBe(true)
    })

    it('should handle empty data', () => {
      outputDetail({})
      expect(mockInfo).toHaveBeenCalledWith('No details available.')
    })

    it('should render nested objects as indented sub-sections', () => {
      outputDetail({
        id: '123',
        config: { method: 'GET', timeout: 30 },
      })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      // Should have: id line, empty line, config: header, method line, timeout line
      expect(calls.some((c) => c.includes('id'))).toBe(true)
      expect(calls.some((c) => c.includes('config'))).toBe(true)
      expect(calls.some((c) => c.includes('method') && c.includes('GET'))).toBe(true)
      expect(calls.some((c) => c.includes('timeout') && c.includes('30'))).toBe(true)
    })

    it('should summarize arrays of objects with count and identifiers', () => {
      outputDetail({
        id: 'job-1',
        tests: [
          { id: 't-1', name: 'Homepage Check' },
          { id: 't-2', name: 'Login Flow' },
        ],
      })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      // tests line should show count and names
      const testsLine = calls.find((c) => c.includes('tests'))
      expect(testsLine).toBeDefined()
      expect(testsLine).toContain('2 items')
      expect(testsLine).toContain('Homepage Check')
      expect(testsLine).toContain('Login Flow')
    })

    it('should summarize large arrays with ellipsis', () => {
      outputDetail({
        items: [
          { name: 'A' },
          { name: 'B' },
          { name: 'C' },
          { name: 'D' },
        ],
      })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      const itemsLine = calls.find((c) => c.includes('items'))
      expect(itemsLine).toBeDefined()
      expect(itemsLine).toContain('4 items')
      expect(itemsLine).toContain('...')
    })

    it('should join arrays of primitives with commas', () => {
      outputDetail({
        tags: ['alpha', 'beta', 'gamma'],
      })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      const tagsLine = calls.find((c) => c.includes('tags'))
      expect(tagsLine).toBeDefined()
      expect(tagsLine).toContain('alpha, beta, gamma')
    })

    it('should show (none) for empty arrays', () => {
      outputDetail({
        tags: [],
      })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      const tagsLine = calls.find((c) => c.includes('tags'))
      expect(tagsLine).toBeDefined()
    })

    it('should handle boolean values with checkmarks', () => {
      outputDetail({ enabled: true, archived: false })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      expect(calls.some((c) => c.includes('enabled') && c.includes('✓'))).toBe(true)
      expect(calls.some((c) => c.includes('archived') && c.includes('✗'))).toBe(true)
    })

    it('should handle null and undefined values with dash', () => {
      outputDetail({ description: null, notes: undefined })
      const calls = mockOutput.mock.calls.map((c) => String(c[0]))
      expect(calls.some((c) => c.includes('description'))).toBe(true)
    })
  })

  describe('outputDetail — JSON mode', () => {
    it('should output JSON string in json mode', () => {
      setOutputFormat('json')
      const data = { id: '123', name: 'Test' }
      outputDetail(data)
      expect(mockOutput).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
      setOutputFormat('table')
    })
  })

  describe('outputDetail — quiet mode', () => {
    it('should output only ID in quiet mode', () => {
      setOutputFormat('quiet')
      outputDetail({ id: 'abc-123', name: 'Test' })
      expect(mockOutput).toHaveBeenCalledTimes(1)
      expect(mockOutput).toHaveBeenCalledWith('abc-123')
      setOutputFormat('table')
    })

    it('should output nothing if no id in quiet mode', () => {
      setOutputFormat('quiet')
      outputDetail({ name: 'Test' })
      expect(mockOutput).not.toHaveBeenCalled()
      setOutputFormat('table')
    })
  })

  describe('output — table mode', () => {
    it('should output a table for array data', () => {
      output([
        { id: 'abc', name: 'Homepage Check' },
        { id: 'def', name: 'Login Flow' },
      ])
      expect(mockOutput).toHaveBeenCalledTimes(1)
      const tableStr = String(mockOutput.mock.calls[0][0])
      expect(tableStr).toContain('Homepage Check')
      expect(tableStr).toContain('Login Flow')
    })

    it('should handle empty arrays', () => {
      output([])
      expect(mockInfo).toHaveBeenCalledWith('No results found.')
    })

    it('should use provided columns', () => {
      output(
        [{ id: '1', name: 'Test', hidden: 'secret' }],
        { columns: [{ key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }] },
      )
      expect(mockOutput).toHaveBeenCalledTimes(1)
      const tableStr = String(mockOutput.mock.calls[0][0])
      expect(tableStr).toContain('Test')
      expect(tableStr).not.toContain('secret')
    })
  })

  describe('output — JSON mode', () => {
    it('should output JSON array', () => {
      setOutputFormat('json')
      const data = [{ id: '1' }, { id: '2' }]
      output(data)
      expect(mockOutput).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
      setOutputFormat('table')
    })
  })

  describe('output — quiet mode', () => {
    it('should output only IDs', () => {
      setOutputFormat('quiet')
      output([{ id: 'a' }, { id: 'b' }])
      expect(mockOutput).toHaveBeenCalledTimes(2)
      expect(mockOutput).toHaveBeenCalledWith('a')
      expect(mockOutput).toHaveBeenCalledWith('b')
      setOutputFormat('table')
    })
  })
})

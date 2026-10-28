import { jest, describe, it, expect } from '@jest/globals'

const mockWarn = jest.fn<(...args: unknown[]) => void>()
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: mockWarn, debug: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))

const { buildMonitorDefinitions, buildJobDefinitions } = await import('../pull.js')
const { jobCronWarning } = await import('../../utils/cron.js')

describe('pull round trip', () => {
  it('drops legacy monitor config keys the server now rejects', () => {
    const [def] = buildMonitorDefinitions([{
      id: 'm', name: 'M', type: 'website', target: 'https://example.com',
      config: { timeoutSeconds: 10, responseBodyJsonPath: '$.a', checkExpiration: true, daysUntilExpirationWarning: 7, checkRevocation: false, sslCheckOnStatusChange: true },
    } as never])
    expect(def.config).toEqual({ timeoutSeconds: 10 })
  })

  it('warns when a pulled job cron is not 5 fields', () => {
    mockWarn.mockClear()
    buildJobDefinitions([{ id: 'j', name: 'Every second', cronSchedule: '* * * * * *', tests: [] } as never], new Map())
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('5-field'))
  })

  it('accepts 5-field and empty crons', () => {
    expect(jobCronWarning('J', '*/5 * * * *')).toBeNull()
    expect(jobCronWarning('J', '')).toBeNull()
  })
})

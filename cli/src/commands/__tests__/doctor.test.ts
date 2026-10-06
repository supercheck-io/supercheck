import { jest, describe, it, expect } from '@jest/globals'

const checkAll = jest.fn<(...args: unknown[]) => []>(() => [])
jest.unstable_mockModule('../../utils/deps.js', () => ({ checkAllDependencies: checkAll, formatDependencyReport: () => '', installPlaywrightBrowsers: jest.fn() }))
jest.unstable_mockModule('../../config/loader.js', () => ({ tryLoadConfig: async () => ({ config: { project: { organization: 'demo', project: 'demo' }, monitors: [] } }) }))
jest.unstable_mockModule('../../auth/store.js', () => ({ isAuthenticated: () => true, getStoredBaseUrl: () => 'https://demo.supercheck.io' }))
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { info: jest.fn(), output: jest.fn(), success: jest.fn(), warn: jest.fn(), newline: jest.fn(), header: jest.fn() } }))
jest.unstable_mockModule('../../output/formatter.js', () => ({ getOutputFormat: () => 'table', output: jest.fn() }))
const { doctorCommand } = await import('../doctor.js')

describe('doctor', () => {
  it('does not require browser or load-test dependencies for a monitoring-only configuration', async () => {
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(checkAll).toHaveBeenCalledWith(process.cwd(), { requirePlaywright: false, requireK6: false })
  })
})

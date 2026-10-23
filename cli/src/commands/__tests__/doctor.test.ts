import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let storedUrl: string | null = 'https://demo.supercheck.io'
const checkAll = jest.fn<(...args: unknown[]) => []>(() => [])
jest.unstable_mockModule('../../utils/deps.js', () => ({ checkAllDependencies: checkAll, formatDependencyReport: () => '', installPlaywrightBrowsers: jest.fn(async () => true) }))
jest.unstable_mockModule('../../auth/store.js', () => ({ isAuthenticated: () => true, getToken: () => 'tok', getStoredBaseUrl: () => storedUrl }))
const apiGet = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ data: {} }))
jest.unstable_mockModule('../../api/client.js', () => ({ getApiClient: () => ({ request: apiGet }) }))
const info = jest.fn()
const warn = jest.fn()
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { info, output: jest.fn(), success: jest.fn(), error: jest.fn(), warn, newline: jest.fn(), header: jest.fn() } }))
jest.unstable_mockModule('../../output/formatter.js', () => ({ getOutputFormat: () => 'table', output: jest.fn() }))
const { doctorCommand } = await import('../doctor.js')
const { detectConfigRequirements } = await import('../../utils/config-text.js')

let dir: string
let cwd: string
beforeEach(() => { storedUrl = 'https://demo.supercheck.io'; apiGet.mockClear(); dir = mkdtempSync(join(tmpdir(), 'sc-doctor-')); cwd = process.cwd(); process.chdir(dir); checkAll.mockClear(); info.mockClear(); warn.mockClear() })
afterEach(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) })
const config = (tests: string) => writeFileSync(join(dir, 'supercheck.config.ts'), `export default { project: { organization: 'o', project: 'p' }, ${tests} }\n`)
const lastArgs = () => checkAll.mock.calls.at(-1)![1] as { requirePlaywright: boolean; requireK6: boolean; browser: string }

describe('doctor requirements are read from the config text', () => {
  it('requires nothing for a monitoring-only config', async () => {
    config('monitors: []')
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(lastArgs()).toMatchObject({ requirePlaywright: false, requireK6: false, browser: 'chromium' })
  })
  it('requires Playwright and the configured browser for a literal playwright block, and k6 for a k6 block', async () => {
    config("tests: { playwright: { browser: 'firefox' }, k6: { testMatch: 'x' } }")
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(lastArgs()).toEqual({ requirePlaywright: true, requireK6: true, browser: 'firefox' })
  })
  it('ignores commented-out runners', async () => {
    config("tests: {}, // tests: { playwright: { browser: 'firefox' }, k6: {} }")
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(lastArgs()).toMatchObject({ requirePlaywright: false, requireK6: false, browser: 'chromium' })
  })
  it('never under-reports: variables and shorthand still count as configured, with a note', async () => {
    config('tests: { playwright: pw, k6 }')
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(lastArgs()).toMatchObject({ requirePlaywright: true, requireK6: true })
    expect(info.mock.calls.flat().join(' ')).toMatch(/computed/)
  })
  it('does not execute the config', async () => {
    writeFileSync(join(dir, 'supercheck.config.ts'), "import { writeFileSync } from 'node:fs'\nwriteFileSync('PWNED', 'x')\nexport default {}\n")
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(await import('node:fs').then((fs) => fs.existsSync(join(dir, 'PWNED')))).toBe(false)
  })
})

describe('doctor output and --fix', () => {
  it('does not print control characters taken from the config', async () => {
    writeFileSync(join(dir, 'supercheck.config.ts'), "export default { project: { organization: 'o\u001b]52;c;x\u0007', project: 'p' } }\n")
    await doctorCommand.parseAsync(['node', 'doctor'])
    const printed = info.mock.calls.flat().join('\n')
    expect(printed.includes(String.fromCharCode(27))).toBe(false)
    expect(printed.includes(String.fromCharCode(7))).toBe(false)
  })
  it('announces that --fix runs the repository\'s own tooling', async () => {
    config("tests: { playwright: { browser: 'chromium' } }")
    checkAll.mockReturnValueOnce([{ name: 'Playwright browsers', installed: false, required: true, installHint: 'npx playwright install chromium' }] as never)
    await doctorCommand.parseAsync(['node', 'doctor', '--fix'])
    expect(warn.mock.calls.flat().join(' ')).toMatch(/--fix runs `npx playwright install`.*repository you trust/)
  })
})

describe('detectConfigRequirements', () => {
  it('handles quoted keys, spreads and a computed browser', () => {
    expect(detectConfigRequirements("tests: { 'playwright': { browser: process.env.B ?? 'firefox' } }")).toMatchObject({ playwright: true, k6: false, browser: 'chromium', dynamic: true })
    expect(detectConfigRequirements('tests: { ...shared, k6: { } }')).toMatchObject({ k6: true, playwright: false, dynamic: false })
  })
  it('is not fooled by words that merely contain a runner name', () => {
    expect(detectConfigRequirements("name: 'my-playwright-suite', description: 'k6x'")).toMatchObject({ playwright: false, k6: false })
  })
})

describe('doctor verifies credentials with the server', () => {
  it('says verified only after /api/context succeeds', async () => {
    config('monitors: []')
    apiGet.mockResolvedValueOnce({ data: {} })
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(info.mock.calls.flat().join(' ')).toMatch(/Authenticated and verified/)
  })
  it('reports rejected credentials instead of claiming success', async () => {
    config('monitors: []')
    const { ApiRequestError } = await import('../../utils/errors.js')
    apiGet.mockRejectedValueOnce(new ApiRequestError('no', 401))
    await doctorCommand.parseAsync(['node', 'doctor'])
    const printed = info.mock.calls.flat().join(' ')
    expect(printed).toMatch(/rejected/)
    expect(printed).not.toMatch(/Authenticated and verified/)
  })
})

describe('doctor --strict exit codes', () => {
  it('uses ApiError when the server cannot be reached, AuthError when rejected', async () => {
    config('monitors: []')
    const { ApiRequestError } = await import('../../utils/errors.js')
    apiGet.mockRejectedValueOnce(new ApiRequestError('down', 503))
    await expect(doctorCommand.parseAsync(['node', 'doctor', '--strict'])).rejects.toMatchObject({ exitCode: 4 })
    apiGet.mockRejectedValueOnce(new ApiRequestError('no', 401))
    await expect(doctorCommand.parseAsync(['node', 'doctor', '--strict'])).rejects.toMatchObject({ exitCode: 2 })
  })
  it('does not retry or wait long when checking credentials', async () => {
    config('monitors: []')
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(apiGet).toHaveBeenLastCalledWith('GET', '/api/context', { retries: 0, timeout: 5000 })
  })
})

describe('doctor with a config that declares its own API URL', () => {
  const selfHosted = () => writeFileSync(join(dir, 'supercheck.config.ts'), "export default { api: { baseUrl: process.env.SUPERCHECK_URL ?? 'https://checks.example.com' }, project: { organization: 'o', project: 'p' } }\n")
  it('does not send the token to the default API or the declared one when no API URL is set', async () => {
    selfHosted()
    storedUrl = null
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(apiGet).not.toHaveBeenCalled()
    const printed = info.mock.calls.flat().join(' ')
    expect(printed).toMatch(/targets .*checks\.example\.com.* set SUPERCHECK_URL/)
    expect(printed).not.toMatch(/rejected/)
  })
  it('is not a strict-mode credential rejection', async () => {
    selfHosted()
    storedUrl = null
    await expect(doctorCommand.parseAsync(['node', 'doctor', '--strict'])).rejects.toMatchObject({ exitCode: 4 })
  })
  it('verifies against the active API and flags the mismatch when one is set', async () => {
    selfHosted()
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(info.mock.calls.flat().join(' ')).toMatch(/Authenticated and verified[\s\S]*targets .*checks\.example\.com/)
  })
  it('says nothing extra when SUPERCHECK_URL is set, since the config follows it', async () => {
    selfHosted()
    process.env.SUPERCHECK_URL = 'https://demo.supercheck.io'
    try {
      await doctorCommand.parseAsync(['node', 'doctor'])
    } finally {
      delete process.env.SUPERCHECK_URL
    }
    expect(info.mock.calls.flat().join(' ')).not.toMatch(/targets/)
  })
  it('says nothing extra when the config matches the active API', async () => {
    selfHosted()
    storedUrl = 'https://checks.example.com'
    await doctorCommand.parseAsync(['node', 'doctor'])
    expect(info.mock.calls.flat().join(' ')).not.toMatch(/targets/)
  })
})

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

let resources: Record<string, unknown[]> = {}
const confirm = jest.fn<(...args: unknown[]) => Promise<boolean>>(async () => false)
const install = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)
const messages: string[] = []
const log = (message: string) => messages.push(message)
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({
    get: async (path: string) => ({ data: path === '/api/context'
      ? { organization: { id: 'org' }, project: { id: 'project' } }
      : resources[path] ?? [] }),
  }),
}))
jest.unstable_mockModule('../../config/loader.js', () => ({ tryLoadConfig: async () => null }))
jest.unstable_mockModule('../../utils/resources.js', () => ({
  fetchAllPages: async (_client: unknown, path: string) => resources[path] ?? [],
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))
jest.unstable_mockModule('../../utils/prompt.js', () => ({ confirmPrompt: confirm }))
jest.unstable_mockModule('../../utils/package-manager.js', () => ({
  detectPackageManager: () => 'npm', ensurePackageJson: jest.fn(), installDependencies: install,
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: log, warn: log, success: log, error: log, header: log, debug: jest.fn(), newline: jest.fn() },
}))
const { pullCommand } = await import('../pull.js')
const remoteTest = { id: '019a0000-0000-7000-8000-000000000001', title: 'Homepage', type: 'browser', script: '// @title Homepage\n' }
let cwd: string
let cwdSpy: ReturnType<typeof jest.spyOn>
const output = () => messages.join('\n')
const pull = (...flags: string[]) => pullCommand.parseAsync(['node', 'pull', ...flags])

beforeEach(() => {
  cwd = mkdtempSync(resolve(tmpdir(), 'supercheck-pull-output-'))
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd)
  writeFileSync(resolve(cwd, 'package.json'), '{}')
  resources = { '/api/monitors': [{ id: 'monitor', name: 'Website', type: 'website' }],
    '/api/notification-providers': [{ id: 'provider', name: 'Discord', type: 'discord', config: {} }] }
  messages.length = 0
  confirm.mockReset().mockResolvedValue(false)
  install.mockClear()
  for (const option of ['force', 'testsOnly', 'configOnly', 'dryRun']) pullCommand.setOptionValue(option, false)
})
afterEach(() => {
  cwdSpy.mockRestore()
  rmSync(cwd, { recursive: true, force: true })
})

describe('pull output and local file effects', () => {
  it('identifies config resources when the remote has no tests and safely defaults to no', async () => {
    await pull()
    expect(output()).toContain('1 monitor(s), 1 notification provider(s)')
    expect(output()).toContain('No remote test scripts to pull.')
    expect(output()).toContain('replace supercheck.config.ts')
    expect(output()).not.toContain('write test scripts')
    expect(confirm).toHaveBeenCalledWith('Continue?', { default: false })
    expect(existsSync(resolve(cwd, 'supercheck.config.ts'))).toBe(false)
  })

  it.each([
    { flags: ['--tests-only'], writesConfig: false, writesTests: true },
    { flags: ['--config-only'], writesConfig: true, writesTests: false },
    { flags: [], writesConfig: true, writesTests: true },
  ])('describes only the selected writes: $flags', async ({ flags, writesConfig, writesTests }) => {
    resources['/api/tests'] = [remoteTest]
    await pull(...flags)
    expect(output().includes('replace supercheck.config.ts')).toBe(writesConfig)
    expect(output().includes('write test scripts')).toBe(writesTests)
    expect(output()).toContain('Pull only copies remote resources to local files.')
  })

  it('scopes an empty tests-only result to test scripts', async () => {
    await pull('--tests-only')
    expect(output()).toContain('No test scripts found on the remote project.')
    expect(output()).toContain('Local-only test scripts are preserved')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('preserves local-only scripts when pulling config resources', async () => {
    const folder = resolve(cwd, '_supercheck_/playwright')
    mkdirSync(folder, { recursive: true })
    const path = resolve(folder, 'local-only.019a0000-0000-7000-8000-000000000002.pw.ts')
    writeFileSync(path, 'local-only script')
    confirm.mockResolvedValue(true)
    await pull()
    expect(readFileSync(path, 'utf-8')).toBe('local-only script')
    expect(readFileSync(resolve(cwd, 'supercheck.config.ts'), 'utf-8')).toContain('Website')
    expect(output()).toContain('Local-only test scripts are preserved')
    expect(output()).not.toContain('Install dependencies:')
  })

  it('keeps dry-run read-only and labels skipped file variables', async () => {
    unlinkSync(resolve(cwd, 'package.json'))
    resources['/api/variables'] = [{ id: 'file', key: 'UPLOAD', type: 'file' }]
    await pull('--dry-run')
    expect(output()).toContain('No remote test scripts to pull.')
    expect(output()).toContain('(file; skipped — managed via dashboard)')
    expect(output()).toContain('Dry run — no files written.')
    expect(output()).toContain('A pull would create or replace supercheck.config.ts')
    expect(output()).toContain('A pull would also create package.json')
    expect(confirm).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(existsSync(resolve(cwd, 'supercheck.config.ts'))).toBe(false)
    expect(existsSync(resolve(cwd, 'package.json'))).toBe(false)
  })

  it('discloses dependency installation before confirmation', async () => {
    unlinkSync(resolve(cwd, 'package.json'))
    await pull()
    expect(output()).toContain('create package.json, install dependencies, and create tsconfig.supercheck.json if missing')
    expect(install).not.toHaveBeenCalled()
  })

  it('limits the up-to-date claim to selected remote resources', async () => {
    resources = { '/api/tests': [remoteTest] }
    await pull('--tests-only', '--force')
    const localOnly = resolve(cwd, '_supercheck_/playwright/local-only.pw.ts')
    writeFileSync(localOnly, 'local-only script')
    messages.length = 0
    await pull('--tests-only', '--force')
    expect(output()).toContain('Selected remote resources are already up to date locally.')
    expect(output()).not.toContain('Everything is already in sync.')
    expect(existsSync(resolve(cwd, 'supercheck.config.ts'))).toBe(false)
    expect(readFileSync(localOnly, 'utf-8')).toBe('local-only script')
    expect(confirm).not.toHaveBeenCalled()
  })
})

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockUnauthenticatedGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockOutputMutation = jest.fn<(...args: unknown[]) => void>()
const mockOutputPagination = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()
const mockError = jest.fn<(...args: unknown[]) => void>()
const mockInfo = jest.fn<(...args: unknown[]) => void>()
const mockHeader = jest.fn<(...args: unknown[]) => void>()
const mockLoadConfig = jest.fn<(...args: unknown[]) => Promise<{ config: Record<string, unknown>; configPath: string }>>()
const mockWaitForRun = jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>()
const mockBuildLocalResources = jest.fn<(...args: unknown[]) => Array<Record<string, unknown>>>()
const mockValidateScripts = jest.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>()
const mockConfirmPrompt = jest.fn<(...args: unknown[]) => Promise<void>>()
let outputFormat = 'table'
let authenticated = true

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, patch: mockPatch, post: mockPost, delete: jest.fn() }),
  getResolvedConfigBaseUrl: () => 'https://config.test',
}))

jest.unstable_mockModule('../../api/client.js', () => ({
  ApiClient: class {},
  getApiClient: () => ({ get: mockUnauthenticatedGet }),
}))

jest.unstable_mockModule('../../auth/store.js', () => ({
  getStoredBaseUrl: () => null,
  isAuthenticated: () => authenticated,
  requireAuth: () => 'test-token',
  requireTriggerKey: () => 'test-trigger-key',
  getToken: () => 'test-token',
  getTriggerKey: () => null,
  getStoredOrganization: () => null,
  getStoredProject: () => null,
  validateTokenFormat: () => true,
  validateTriggerKeyFormat: () => true,
  setToken: () => undefined,
  clearAuth: () => undefined,
  setBaseUrl: () => undefined,
  setOrganization: () => undefined,
  setProject: () => undefined,
}))

jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  outputMutation: mockOutputMutation,
  outputPagination: mockOutputPagination,
  getOutputFormat: () => outputFormat,
}))

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    output: mockOutput,
    info: mockInfo,
    success: mockSuccess,
    error: mockError,
    warn: mockWarn,
    header: mockHeader,
    newline: jest.fn(),
  },
}))

jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
  createSpinner: () => ({
    start: () => undefined,
    stop: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
    setText: () => undefined,
  }),
}))

jest.unstable_mockModule('../../utils/prompt.js', () => ({
  confirmPrompt: mockConfirmPrompt,
}))

jest.unstable_mockModule('../../utils/wait.js', () => ({
  waitForRun: mockWaitForRun,
}))

jest.unstable_mockModule('../../config/loader.js', () => ({
  loadConfig: mockLoadConfig,
}))

jest.unstable_mockModule('../../utils/resources.js', () => ({
  buildLocalResources: mockBuildLocalResources,
}))

jest.unstable_mockModule('../../utils/validation.js', () => ({
  normalizeTestTypeForApi: (value: unknown) => value ?? 'playwright',
  validateScripts: mockValidateScripts,
  validateScriptTypeMatch: (script: string, declaredType: string) =>
    script.includes('k6') && declaredType !== 'k6' ? 'script does not match declared test type' : null,
}))

const { jobCommand } = await import('../jobs.js')
const { tagCommand } = await import('../tags.js')
const { auditCommand } = await import('../audit.js')
const { alertCommand } = await import('../alerts.js')
const { healthCommand, locationsCommand } = await import('../health.js')
const { runCommand } = await import('../runs.js')
const { configCommand } = await import('../config.js')
const { skillsCommand, schemaCommand, capabilitiesCommand } = await import('../skills.js')
const { validateCommand } = await import('../validate.js')
const { ExitCode } = await import('../../utils/errors.js')

function resetCommandState(command: import('commander').Command): void {
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), option.defaultValue)
  }
  for (const child of command.commands) resetCommandState(child)
}

describe('read-only and operational commands', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    outputFormat = 'table'
    authenticated = true
    for (const command of [
      jobCommand,
      tagCommand,
      auditCommand,
      alertCommand,
      healthCommand,
      locationsCommand,
      runCommand,
      configCommand,
      skillsCommand,
      schemaCommand,
      capabilitiesCommand,
      validateCommand,
    ]) {
      resetCommandState(command)
    }
  })

  describe('job update', () => {
    it('replaces the job test list using the PATCH schema', async () => {
      mockPatch.mockResolvedValueOnce({ data: { id: 'job-1' } })
      await jobCommand.parseAsync(['node', 'job', 'update', 'job-1', '--tests', 'test-1', 'test-2'])
      expect(mockPatch).toHaveBeenCalledWith('/api/jobs/job-1', { tests: [{ id: 'test-1' }, { id: 'test-2' }] })
    })
    it('shows test replacements without mutating on dry run', async () => {
      await jobCommand.parseAsync(['node', 'job', 'update', 'job-1', '--tests', 'test-1', '--dry-run'])
      expect(mockPatch).not.toHaveBeenCalled()
      expect(mockOutputDetail).toHaveBeenCalledWith({ dryRun: true, payload: { tests: [{ id: 'test-1' }] } })
    })
  })

  describe('tag', () => {
    it('creates a tag with an optional colour', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'tag-1', name: 'smoke' } })

      await tagCommand.parseAsync(['node', 'tag', 'create', 'smoke', '--color', '#ff0000'])

      expect(mockPost).toHaveBeenCalledWith('/api/tags', { name: 'smoke', color: '#ff0000' })
      expect(mockSuccess).toHaveBeenCalledWith('Tag "smoke" created (tag-1)')
    })

    it('rejects tag names outside the documented length', async () => {
      await expect(tagCommand.parseAsync(['node', 'tag', 'create', 'ab'])).rejects.toMatchObject({
        exitCode: ExitCode.ConfigError,
        message: 'Tag name must be 3–20 characters.',
      })
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('deletes without prompting when --force is passed', async () => {
      await tagCommand.parseAsync(['node', 'tag', 'delete', 'tag-1', '--force'])

      expect(mockConfirmPrompt).not.toHaveBeenCalled()
      expect(mockOutputMutation).toHaveBeenCalledWith({ id: 'tag-1', deleted: true })
    })

    it('requires confirmation for a destructive delete without --force', async () => {
      mockConfirmPrompt.mockResolvedValueOnce(undefined)

      await tagCommand.parseAsync(['node', 'tag', 'delete', 'tag-1'])

      expect(mockConfirmPrompt).toHaveBeenCalledWith('Delete tag tag-1?', { default: false })
    })
  })

  describe('audit', () => {
    it('maps audit log rows and forwards pagination', async () => {
      const pagination = {
        currentPage: 2,
        totalPages: 4,
        totalCount: 61,
        limit: 20,
        hasNext: true,
        hasPrev: true,
      }
      mockGet.mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            logs: [
              {
                id: 'log-1',
                action: 'project.delete',
                details: {},
                createdAt: '2026-10-01T10:00:00.000Z',
                user: { id: 'user-1', name: 'Ada', email: 'ada@example.test' },
              },
              {
                id: 'log-2',
                action: 'project.update',
                details: {},
                createdAt: '2026-10-02T10:00:00.000Z',
                user: { id: 'user-2', name: 'Grace', email: null },
              },
            ],
            pagination,
          },
        },
      })

      await auditCommand.parseAsync(['node', 'audit', '--page', '2', '--search', 'project', '--action', 'delete'])

      expect(mockGet).toHaveBeenCalledWith('/api/audit', {
        page: '2',
        limit: '20',
        search: 'project',
        action: 'delete',
      })
      const [rows] = mockOutput.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(rows).toEqual([
        { id: 'log-1', action: 'project.delete', user: 'ada@example.test', createdAt: '2026-10-01T10:00:00.000Z' },
        { id: 'log-2', action: 'project.update', user: 'Grace', createdAt: '2026-10-02T10:00:00.000Z' },
      ])
      expect(mockOutputPagination).toHaveBeenCalledWith(pagination)
    })

    it('fails with an API error when the server reports failure', async () => {
      mockGet.mockResolvedValueOnce({ data: { success: false, data: { logs: [], pagination: {} } } })

      await expect(auditCommand.parseAsync(['node', 'audit'])).rejects.toMatchObject({
        exitCode: ExitCode.ApiError,
        message: 'Failed to fetch audit logs',
      })
      expect(mockOutput).not.toHaveBeenCalled()
    })
  })

  describe('alert history', () => {
    it('accepts a flat array response', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 'alert-1', status: 'firing' }] })

      await alertCommand.parseAsync(['node', 'alert', 'history'])

      const [rows] = mockOutput.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(rows).toEqual([{ id: 'alert-1', status: 'firing' }])
      expect(mockOutputPagination).toHaveBeenCalledWith(null)
    })

    it('accepts a paginated response and forwards its metadata', async () => {
      const pagination = { currentPage: 1, totalPages: 1, totalCount: 1, limit: 50, hasNext: false, hasPrev: false }
      mockGet.mockResolvedValueOnce({ data: { data: [{ id: 'alert-2' }], pagination } })

      await alertCommand.parseAsync(['node', 'alert', 'history', '--limit', '25'])

      expect(mockGet).toHaveBeenCalledWith('/api/alerts/history', { page: '1', limit: '25' })
      expect(mockOutputPagination).toHaveBeenCalledWith(pagination)
    })
  })

  describe('health', () => {
    it('reports component status from the health endpoint', async () => {
      mockUnauthenticatedGet.mockResolvedValueOnce({
        data: {
          status: 'ok',
          latencyMs: 12,
          checks: { database: { status: 'ok' }, redis: { status: 'ok' }, s3: { status: 'ok' } },
        },
      })

      await healthCommand.parseAsync(['node', 'health', '--url', 'https://api.test'])

      expect(mockUnauthenticatedGet).toHaveBeenCalledWith('/api/health')
      expect(mockOutput).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ok', database: 'ok', redis: 'ok', s3: 'ok', latencyMs: 12 }),
        expect.objectContaining({ columns: expect.any(Array) }),
      )
      expect(mockSuccess).toHaveBeenCalledWith('API is healthy at https://api.test')
    })

    it('throws an API error when the API reports a degraded status', async () => {
      mockUnauthenticatedGet.mockResolvedValueOnce({
        data: { status: 'degraded', checks: { database: { status: 'error' } } },
      })

      await expect(
        healthCommand.parseAsync(['node', 'health', '--url', 'https://api.test']),
      ).rejects.toMatchObject({
        exitCode: ExitCode.ApiError,
        message: 'API reports degraded status at https://api.test',
      })
    })

    it('normalises both locations response shapes', async () => {
      mockGet.mockResolvedValueOnce({ data: { locations: [{ code: 'eu', name: 'EU', region: 'eu-central' }] } })
      await locationsCommand.parseAsync(['node', 'locations'])
      expect(mockOutput).toHaveBeenCalledWith(
        [{ code: 'eu', name: 'EU', region: 'eu-central' }],
        expect.objectContaining({ columns: expect.any(Array) }),
      )

      mockGet.mockResolvedValueOnce({ data: { success: true, data: [{ code: 'us', name: 'US', region: 'us-east' }] } })
      await locationsCommand.parseAsync(['node', 'locations'])
      expect(mockOutput).toHaveBeenLastCalledWith(
        [{ code: 'us', name: 'US', region: 'us-east' }],
        expect.objectContaining({ columns: expect.any(Array) }),
      )
    })
  })

  describe('runs', () => {
    it('lists runs with filters and pagination', async () => {
      const pagination = { currentPage: 1, totalPages: 1, totalCount: 1, limit: 50, hasNext: false, hasPrev: false }
      mockGet.mockResolvedValueOnce({ data: { data: [{ id: 'run-1', status: 'passed' }], pagination } })

      await runCommand.parseAsync(['node', 'run', 'list', '--status', 'passed', '--job', 'job-9'])

      expect(mockGet).toHaveBeenCalledWith('/api/runs', {
        page: '1',
        limit: '50',
        jobId: 'job-9',
        status: 'passed',
      })
      expect(mockOutputPagination).toHaveBeenCalledWith(pagination)
    })

    it('unwraps the permissions payload when the API nests it in data', async () => {
      mockGet.mockResolvedValueOnce({ data: { data: { canView: true, canCancel: false } } })

      await runCommand.parseAsync(['node', 'run', 'permissions', 'run-1'])

      expect(mockOutputDetail).toHaveBeenCalledWith({ canView: true, canCancel: false })
    })

    it('cancels a run through the dedicated endpoint', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } })

      await runCommand.parseAsync(['node', 'run', 'cancel', 'run-1'])

      expect(mockPost).toHaveBeenCalledWith('/api/runs/run-1/cancel')
      expect(mockOutputDetail).toHaveBeenCalledWith({ success: true })
    })

    it('waits with a bounded deadline converted from seconds', async () => {
      mockWaitForRun.mockResolvedValueOnce({ id: 'run-1', status: 'passed' })

      await runCommand.parseAsync(['node', 'run', 'wait', 'run-1', '--timeout', '90'])

      expect(mockWaitForRun).toHaveBeenCalledWith(expect.anything(), 'run-1', 90_000)
      expect(mockOutputDetail).toHaveBeenCalledWith({ id: 'run-1', status: 'passed' })
    })

    it('rejects a non-numeric timeout instead of waiting forever', async () => {
      await expect(
        runCommand.parseAsync(['node', 'run', 'wait', 'run-1', '--timeout', 'soon']),
      ).rejects.toMatchObject({ exitCode: ExitCode.ConfigError })
      expect(mockWaitForRun).not.toHaveBeenCalled()
    })
  })

  describe('config', () => {
    it('validates and reports the resolved project identity', async () => {
      mockLoadConfig.mockResolvedValueOnce({
        configPath: '/repo/supercheck.config.ts',
        config: { project: { organization: 'acme', project: 'checkout' } },
      })

      await configCommand.parseAsync(['node', 'config', 'validate'])

      expect(mockLoadConfig).toHaveBeenCalledWith({ configPath: undefined, offline: undefined })
      expect(mockSuccess).toHaveBeenCalledWith('Valid configuration loaded from /repo/supercheck.config.ts')
      expect(mockInfo).toHaveBeenCalledWith('  Organization: acme')
      expect(mockInfo).toHaveBeenCalledWith('  Project:      checkout')
    })

    it('prints a redacted configuration so credentials never reach stdout', async () => {
      mockLoadConfig.mockResolvedValueOnce({
        configPath: '/repo/supercheck.config.ts',
        config: {
          project: { organization: 'acme', project: 'checkout' },
          apiToken: 'sck_live_abcdefghijklmnop',
          notifications: [{ type: 'webhook', webhookUrl: 'https://hooks.test/abc' }],
        },
      })

      await configCommand.parseAsync(['node', 'config', 'print'])

      const [rendered] = mockOutput.mock.calls[0] as [string]
      expect(rendered).toContain('"organization": "acme"')
      expect(rendered).toContain('[REDACTED]')
      expect(rendered).not.toContain('sck_live_abcdefghijklmnop')
      expect(rendered).not.toContain('hooks.test/abc')
      expect(JSON.parse(rendered)).toMatchObject({ project: { organization: 'acme', project: 'checkout' } })
    })
  })

  describe('skills', () => {
    it('prints the index when no topic is given', async () => {
      await skillsCommand.parseAsync(['node', 'skills'])

      const [content] = mockOutput.mock.calls[0] as [string]
      expect(content).toContain('# Supercheck agent guide')
      expect(content).toContain('supercheck skills local')
      expect(content).toContain('supercheck skills investigate')
    })

    it('rejects an unknown topic', async () => {
      await expect(skillsCommand.parseAsync(['node', 'skills', 'nope'])).rejects.toMatchObject({
        exitCode: ExitCode.ConfigError,
        message: 'Unknown skills topic: nope. Use supercheck skills.',
      })
    })

    it('emits a machine-readable payload for a known topic in json mode', async () => {
      outputFormat = 'json'

      await skillsCommand.parseAsync(['node', 'skills', 'execute'])

      expect(mockOutputDetail).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'execute', content: expect.stringContaining('# Execute and verify') }),
      )
    })

    describe('install', () => {
      let directory: string

      beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'supercheck-skill-'))
      })

      afterEach(() => {
        rmSync(directory, { recursive: true, force: true })
      })

      it('writes the skill pointer into the requested directory', async () => {
        await skillsCommand.parseAsync(['node', 'skills', 'install', '--path', directory])

        const installed = join(directory, 'SKILL.md')
        expect(existsSync(installed)).toBe(true)
        expect(readFileSync(installed, 'utf8')).toContain('name: supercheck')
        expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ installed: true, path: installed }))
      })

      it('refuses to overwrite an existing skill without --force', async () => {
        const installed = join(directory, 'SKILL.md')
        writeFileSync(installed, 'operator notes')

        await expect(
          skillsCommand.parseAsync(['node', 'skills', 'install', '--path', directory]),
        ).rejects.toMatchObject({
          exitCode: ExitCode.ConfigError,
          message: expect.stringContaining('Use --force to replace it.'),
        })
        expect(readFileSync(installed, 'utf8')).toBe('operator notes')
      })

      it('replaces an existing skill when --force is passed', async () => {
        const installed = join(directory, 'SKILL.md')
        writeFileSync(installed, 'operator notes')

        await skillsCommand.parseAsync(['node', 'skills', 'install', '--path', directory, '--force'])

        expect(readFileSync(installed, 'utf8')).toContain('name: supercheck')
      })
    })

    it('describes the configuration schema without network access', async () => {
      await schemaCommand.parseAsync(['node', 'schema', 'config'])

      expect(mockGet).not.toHaveBeenCalled()
      const [payload] = mockOutputDetail.mock.calls[0] as [{ schema: { type: string; properties: Record<string, unknown> } }]
      expect(payload.schema.type).toBe('object')
      expect(payload.schema.properties).toHaveProperty('project')
    })

    it('keeps capabilities offline unless --online is requested', async () => {
      await capabilitiesCommand.parseAsync(['node', 'capabilities'])

      expect(mockGet).not.toHaveBeenCalled()
      expect(mockOutputDetail).toHaveBeenCalledWith(
        expect.objectContaining({ contextVerified: false, context: null, statusPageMutations: false }),
      )
    })

    it('verifies the server context when --online is requested', async () => {
      mockGet.mockResolvedValueOnce({ data: { userId: 'user-1' } })

      await capabilitiesCommand.parseAsync(['node', 'capabilities', '--online'])

      expect(mockGet).toHaveBeenCalledWith('/api/context')
      expect(mockOutputDetail).toHaveBeenCalledWith(
        expect.objectContaining({ contextVerified: true, context: { userId: 'user-1' } }),
      )
    })
  })

  describe('validate', () => {
    const config = { project: { organization: 'acme', project: 'checkout' } }

    it('validates every local test and reports warnings', async () => {
      mockLoadConfig.mockResolvedValueOnce({ config, configPath: '/repo/supercheck.config.ts' })
      mockBuildLocalResources.mockReturnValueOnce([
        { type: 'test', name: 'smoke', definition: { script: 'page.goto()', testType: 'playwright' } },
      ])
      mockValidateScripts.mockResolvedValueOnce([{ name: 'smoke', valid: true, warnings: ['deprecated API'] }])

      await validateCommand.parseAsync(['node', 'validate'])

      expect(mockValidateScripts).toHaveBeenCalledWith(expect.anything(), [
        { name: 'smoke', script: 'page.goto()', testType: 'playwright' },
      ])
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Warnings: deprecated API'))
      expect(mockSuccess).toHaveBeenCalledWith('All tests passed validation.')
    })

    it('fails when the server rejects a script', async () => {
      mockLoadConfig.mockResolvedValueOnce({ config, configPath: '/repo/supercheck.config.ts' })
      mockBuildLocalResources.mockReturnValueOnce([
        { type: 'test', name: 'smoke', definition: { script: 'page.goto()', testType: 'playwright' } },
      ])
      mockValidateScripts.mockResolvedValueOnce([{ name: 'smoke', valid: false, error: 'syntax error' }])

      await expect(validateCommand.parseAsync(['node', 'validate'])).rejects.toMatchObject({
        exitCode: ExitCode.ConfigError,
        message: 'Validation failed for 1 test(s).',
      })
    })

    it('fails fast on a script/type mismatch without calling the API', async () => {
      mockLoadConfig.mockResolvedValueOnce({ config, configPath: '/repo/supercheck.config.ts' })
      mockBuildLocalResources.mockReturnValueOnce([
        { type: 'test', name: 'load', definition: { script: 'k6 run script.js', testType: 'playwright' } },
      ])

      await expect(validateCommand.parseAsync(['node', 'validate'])).rejects.toMatchObject({
        exitCode: ExitCode.ConfigError,
        message: 'Script-type mismatch detected. Fix the test type or script content before validating.',
      })
      expect(mockValidateScripts).not.toHaveBeenCalled()
    })

    it('warns instead of failing when the project has no local tests', async () => {
      mockLoadConfig.mockResolvedValueOnce({ config, configPath: '/repo/supercheck.config.ts' })
      mockBuildLocalResources.mockReturnValueOnce([])

      await validateCommand.parseAsync(['node', 'validate'])

      expect(mockWarn).toHaveBeenCalledWith('No local tests found to validate.')
      expect(mockValidateScripts).not.toHaveBeenCalled()
    })
  })
})

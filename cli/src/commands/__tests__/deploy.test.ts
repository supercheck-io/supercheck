import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const M1 = '019a0000-0000-7000-8000-0000000000a1'
const TOKEN = `hb_${'5e'.repeat(16)}`
const PING_URL = `https://app.example.com/api/heartbeat/${TOKEN}`
const post = jest.fn<(path: string, body?: unknown) => Promise<{ data: unknown }>>(async () => ({ data: { id: M1, type: 'heartbeat', heartbeat: { pingUrl: PING_URL, state: 'pending' } } }))
const put = jest.fn<(path: string, body?: unknown) => Promise<{ data: unknown }>>(async () => ({ data: {} }))
const record = jest.fn()
const output = jest.fn()
const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
let remote: unknown[] = []
let localId: string | undefined

const definition = {
  name: 'Nightly backup', type: 'heartbeat', frequencyMinutes: 1440,
  config: { heartbeat: { graceMinutes: 60 } },
  alertConfig: { enabled: true, warnings: { heartbeat_late: true } },
}

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ post, put, delete: jest.fn(), get: jest.fn(async () => ({ data: [] })) }) }))
jest.unstable_mockModule('../../config/loader.js', () => ({ loadConfig: async () => ({ config: {} }) }))
jest.unstable_mockModule('../../utils/resources.js', () => ({
  buildLocalResources: () => [{ id: localId, type: 'monitor', name: definition.name, definition }],
  fetchRemoteResources: async () => remote,
  getApiEndpoint: () => '/api/monitors',
}))
jest.unstable_mockModule('../../utils/validation.js', () => ({
  normalizeTestTypeForApi: () => 'browser', validateScripts: async () => [], validateScriptTypeMatch: () => null, rejectGlobTestRefs: () => {},
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn() }))
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn(), output } }))
jest.unstable_mockModule('../../utils/managed.js', () => ({
  describeTarget: () => 'target',
  verifyContext: async () => ({ organization: { id: 'org' }, project: { id: 'project' } }),
  deploymentLock: () => () => undefined,
  rejectAmbiguousCreates: () => undefined,
  managedState: () => ({ path: 'state.json', apply: (v: unknown) => v, resolveTests: (v: unknown) => v, record, resolve: (_t: string, ref: string) => ref }),
}))
const { deployCommand } = await import('../deploy.js')
const { setOutputFormat } = await import('../../output/formatter.js')

beforeEach(() => {
  post.mockClear(); put.mockClear(); record.mockClear(); output.mockClear(); stderr.mockClear()
  remote = []
  localId = undefined
  setOutputFormat('table')
  deployCommand.setOptionValue('delete', false); deployCommand.setOptionValue('dryRun', false); deployCommand.setOptionValue('force', false)
})

describe('deploy heartbeat monitors', () => {
  it('creates with interval, grace and warnings, and prints the ping URL once without redaction', async () => {
    await deployCommand.parseAsync(['node', 'deploy', '--force'])
    expect(post).toHaveBeenCalledWith('/api/monitors', definition)
    const lines = output.mock.calls.filter(([text]) => String(text).includes(PING_URL))
    expect(lines).toHaveLength(1)
    expect(lines[0][1]).toEqual({ redact: false })
    // Managed state stores only the id.
    expect(JSON.stringify(record.mock.calls)).not.toContain(TOKEN)
  })

  it.each(['json', 'quiet'] as const)('keeps the ping URL out of %s output and says how to reveal it', async (format) => {
    setOutputFormat(format)
    await deployCommand.parseAsync(['node', 'deploy', '--force'])
    const stdout = output.mock.calls.map(([text]) => String(text)).join('\n')
    expect(stdout).not.toMatch(/hb_[0-9a-f]{32}/)
    if (format === 'json') expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).results).toEqual([expect.objectContaining({ action: 'create', type: 'monitor', id: M1 })])
    // Straight to stderr: --json and --quiet silence logger warnings.
    expect(stderr.mock.calls.flat().join('')).toContain(`supercheck monitor heartbeat-url ${M1}`)
  })

  it('an update that drops an enabled warning sends it as false, so the next diff is clean', async () => {
    localId = M1
    remote = [{ id: M1, type: 'monitor', name: definition.name, raw: { ...definition, alertConfig: { enabled: true, warnings: { heartbeat_late: true } } } }]
    const local = { ...definition, alertConfig: { enabled: true } }
    const original = definition.alertConfig
    Object.assign(definition, { alertConfig: local.alertConfig })
    try {
      await deployCommand.parseAsync(['node', 'deploy', '--force'])
    } finally { Object.assign(definition, { alertConfig: original }) }
    expect(put).toHaveBeenCalledWith(`/api/monitors/${M1}`, { ...local, alertConfig: { enabled: true, warnings: { heartbeat_late: false } } })
  })

  it('an update that drops a turned-off default-on warning sends it as true (its default)', async () => {
    localId = M1
    remote = [{ id: M1, type: 'monitor', name: definition.name, raw: { ...definition, alertConfig: { enabled: true, warnings: { mcp_tools_changed: false } } } }]
    const local = { ...definition, alertConfig: { enabled: true } }
    const original = definition.alertConfig
    Object.assign(definition, { alertConfig: local.alertConfig })
    try {
      await deployCommand.parseAsync(['node', 'deploy', '--force'])
    } finally { Object.assign(definition, { alertConfig: original }) }
    expect(put).toHaveBeenCalledWith(`/api/monitors/${M1}`, { ...local, alertConfig: { enabled: true, warnings: { mcp_tools_changed: true } } })
  })

  it('an update shows no ping URL (it is returned only on create)', async () => {
    localId = M1
    remote = [{ id: M1, type: 'monitor', name: definition.name, raw: { ...definition, frequencyMinutes: 60 } }]
    put.mockResolvedValueOnce({ data: { heartbeat: { pingUrl: PING_URL } } })
    await deployCommand.parseAsync(['node', 'deploy', '--force'])
    expect(put).toHaveBeenCalledWith(`/api/monitors/${M1}`, definition)
    expect(JSON.stringify(output.mock.calls)).not.toContain(TOKEN)
  })
})

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const get = jest.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
const post = jest.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
const patch = jest.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get, post, patch }),
  getResolvedConfigBaseUrl: () => 'https://config.test',
}))
const { testCommand, collectLocalTests } = await import('../tests.js')
const { buildLocalResources } = await import('../../utils/resources.js')
const { supercheckConfigSchema } = await import('../../config/schema.js')

const pw = "import { test } from '@playwright/test'\ntest('x', async () => {})\n"
const agentSdk = "import { test, expect } from '@supercheck/agent-test'\ntest('x', async () => {})\n"
let dir: string
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'supercheck-type-header-')))
  get.mockReset(); post.mockReset(); patch.mockReset()
  post.mockResolvedValue({ data: { id: 'new' } }); patch.mockResolvedValue({ data: { id: 't' } })
  get.mockResolvedValue({ data: { type: 'browser' } })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, body); return p }
const create = (f: string, ...extra: string[]) => testCommand.parseAsync(['node', 'test', 'create', '--title', 'T', '--file', f, ...extra])
const update = (f: string, ...extra: string[]) => testCommand.parseAsync(['node', 'test', 'update', 'id-1', '--file', f, ...extra])

describe('test create --file type', () => {
  it.each([
    ['header', `// @type api\n${pw}`, [], 'api'],
    ['agent SDK import', agentSdk, [], 'agent'],
    ['--type beats header', `// @type api\n${pw}`, ['--type', 'custom'], 'custom'],
    ['k6 filename when nothing else says', pw, [], 'performance'],
  ])('%s', async (label, body, extra, expected) => {
    const f = file(label === 'k6 filename when nothing else says' ? 'a.k6.ts' : 'a.pw.ts', label.startsWith('k6') ? "import http from 'k6/http'\nexport default function () { http.get('x') }\n" : body)
    await create(f, ...extra)
    expect((post.mock.calls[0][1] as { type: string }).type).toBe(expected)
  })
})

describe('test update --file type', () => {
  it('sends the header type', async () => {
    await update(file('a.pw.ts', `// @type api\n${pw}`))
    expect((patch.mock.calls[0][1] as { type?: string }).type).toBe('api')
  })
  it('keeps omitting the type with no --type and no header', async () => {
    await update(file('b.pw.ts', pw))
    expect(patch.mock.calls[0][1]).not.toHaveProperty('type')
  })
})

describe('local run refusal', () => {
  it.each(['agent', 'api', 'database', 'custom'])('refuses a // @type %s header', (type) => {
    const f = file('c.pw.ts', `// @type ${type}\n${pw}`)
    expect(() => collectLocalTests(dir, {}, { file: f })).toThrow('executed remotely')
  })
  it('refuses a script importing the agent SDK with no header', () => {
    expect(() => collectLocalTests(dir, {}, { file: file('d.pw.ts', agentSdk) })).toThrow('executed remotely')
  })
  it('still runs a plain browser test', () => {
    expect(collectLocalTests(dir, {}, { file: file('e.pw.ts', pw) })).toHaveLength(1)
  })
})

describe('local batch discovery', () => {
  it('skips remote-only files with a notice and still runs the rest', () => {
    mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
    const put = (n: string, body: string) => writeFileSync(join(dir, '_supercheck_', 'playwright', n), body)
    put('a.019a0000-0000-7000-8000-000000000001.pw.ts', pw)
    put('b.019a0000-0000-7000-8000-000000000002.pw.ts', `// @type api\n${pw}`)
    put('c.019a0000-0000-7000-8000-000000000003.pw.ts', agentSdk)
    const tests = collectLocalTests(dir, { playwright: '_supercheck_/playwright/**/*.pw.ts' }, { all: true })
    expect(tests.map((t) => t.name)).toEqual([expect.stringContaining('a.019a')])
  })
})

describe('JSDoc @type expressions', () => {
  it('does not throw on test update --file or strip a JSDoc @type word that is not ours', async () => {
    const f = file('u.pw.ts', `/**\n * @type string\n */\n${pw}`)
    await update(f)
    expect(patch.mock.calls[0][1]).not.toHaveProperty('type')
    expect(Buffer.from((patch.mock.calls[0][1] as { script: string }).script, 'base64').toString()).toContain('@type string')
  })
  it('deploys a file starting with a JSDoc type expression, keeping the line', () => {
    mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
    const script = `/**\n * @type {import('x').Y}\n */\n${pw}`
    writeFileSync(join(dir, '_supercheck_', 'playwright', 'j.019a0000-0000-7000-8000-000000000100.pw.ts'), script)
    const config = supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, tests: { playwright: {}, k6: {} } })
    const [r] = buildLocalResources(config, dir)
    expect((r.definition as { script: string }).script).toContain("@type {import('x').Y}")
    expect(r.definition).not.toHaveProperty('testType')
  })
  it('ignores an unknown word in a JSDoc @type but rejects it in a // @type line', () => {
    mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
    const p = join(dir, '_supercheck_', 'playwright', 'j.019a0000-0000-7000-8000-000000000100.pw.ts')
    const config = supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, tests: { playwright: {}, k6: {} } })
    writeFileSync(p, `/**\n * @type string\n */\n${pw}`)
    expect(() => buildLocalResources(config, dir)).not.toThrow()
    writeFileSync(p, `// @type bogus\n${pw}`)
    expect(() => buildLocalResources(config, dir)).toThrow('@type must be')
  })
})

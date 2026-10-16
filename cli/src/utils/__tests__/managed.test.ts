import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hostname, tmpdir } from 'node:os'
import { ApiClient } from '../../api/client.js'
import { managedState, deploymentLock, rejectAmbiguousCreates, verifyContext } from '../managed.js'
import { redact, setRevealSecrets } from '../redact.js'
let dir: string
const context = { organization: { id: 'org' }, project: { id: 'project' } }
const client = new ApiClient({ baseUrl: 'https://example.com' })
const a = '019a1234-1234-7123-8123-000000000001', b = '019a1234-1234-7123-8123-000000000002', c = '019a1234-1234-7123-8123-000000000003'
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'supercheck-state-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }); setRevealSecrets(false) })
describe('target-bound deployment identity', () => {
  it('resolves replacement chains, relative paths, and persisted IDs', () => {
    const path = join(dir, 'supercheck.config.ts')
    const state = managedState(client, context, path)
    state.record('test', 'playwright/home.pw.ts', a)
    expect(state.resolve('test', './_supercheck_/playwright/home.pw.ts')).toBe(a)
    expect(state.resolve('test', '_supercheck_\\playwright\\home.pw.ts')).toBe(a)
    state.record('test', 'playwright/home.pw.ts', b, a)
    state.record('test', 'playwright/home.pw.ts', c, b)
    expect(managedState(client, context, path).resolve('test', a)).toBe(c)
    expect(() => managedState(client, { ...context, project: { id: 'other' } }, path).resolve('test', 'playwright/home.pw.ts')).toThrow('Unresolved')
  })
  it('rejects replacement cycles and overlapping local deployments', () => {
    const path = join(dir, 'supercheck.config.ts')
    const release = deploymentLock(path)
    try { expect(() => deploymentLock(path)).toThrow('DEPLOY_LOCKED') } finally { release() }
    writeFileSync(join(dir, 'supercheck.state.json'), JSON.stringify({ version: 1, targets: { 'https://example.com|org|project': { [`replacement:test:${a}`]: b, [`replacement:test:${b}`]: a } } }))
    expect(() => managedState(client, context, path).resolve('test', a)).toThrow('cycle')
  })
  it('refuses implicit name adoption and duplicate local identities', () => {
    const local = { type: 'monitor' as const, name: 'API', definition: {} }
    expect(() => rejectAmbiguousCreates([local], [{ id: a, type: 'monitor', name: 'API', raw: {} }])).toThrow('UNMANAGED_RESOURCE')
    expect(() => rejectAmbiguousCreates([local, local], [])).toThrow('Duplicate')
    expect(() => rejectAmbiguousCreates([{ ...local, id: a }, { ...local, id: a, name: 'Other' }], [])).toThrow('Duplicate local resource ID')
  })
  it('keeps explicit-ID reference aliases transient when recording unrelated resources', () => {
    const path = join(dir, 'supercheck.config.ts')
    const state = managedState(client, context, path)
    state.apply([{ type: 'notificationProvider', id: a, name: 'Alerts', definition: {} }])
    expect(state.resolve('notificationProvider', 'Alerts')).toBe(a)
    state.record('monitor', 'API', b)
    expect(readFileSync(join(dir, 'supercheck.state.json'), 'utf8')).not.toContain('Alerts')
  })
  it('retires an old name when an explicit ID is renamed without adopting a new same-name definition', () => {
    const path = join(dir, 'supercheck.config.ts')
    managedState(client, context, path).record('monitor', 'Old', a)
    const state = managedState(client, context, path)
    const resources = state.apply([
      { type: 'monitor', id: a, name: 'Renamed', definition: {} },
      { type: 'monitor', name: 'Old', definition: {} },
    ])
    expect(resources.map((resource) => resource.id)).toEqual([a, undefined])
    state.record('monitor', 'Renamed', a)
    expect(() => managedState(client, context, path).resolve('monitor', 'Old')).toThrow('Unresolved')
    expect(managedState(client, context, path).resolve('monitor', 'Renamed')).toBe(a)
  })
})
describe('deployment lock recovery', () => {
  it('takes over a lock whose owning process is gone and releases idempotently', () => {
    const path = join(dir, 'supercheck.config.ts')
    writeFileSync(join(dir, 'supercheck.state.json.lock'), `2147483646\n${hostname()}\n`)
    const release = deploymentLock(path)
    expect(readFileSync(join(dir, 'supercheck.state.json.lock'), 'utf8')).toBe(`${process.pid}\n${hostname()}\n`)
    release()
    expect(existsSync(join(dir, 'supercheck.state.json.lock'))).toBe(false)
    expect(() => release()).not.toThrow()
  })
  it('keeps a lock held by a live or unidentifiable owner', () => {
    const path = join(dir, 'supercheck.config.ts')
    for (const owner of [`${process.pid}\n${hostname()}\n`, 'garbage', `2147483646\nsome-other-host\n`, '2147483646\n']) {
      writeFileSync(join(dir, 'supercheck.state.json.lock'), owner)
      expect(() => deploymentLock(path)).toThrow('DEPLOY_LOCKED')
    }
  })
})
describe('wrong-target guard', () => {
  const config = { project: { organization: 'acme', project: 'web' } }
  const respond = (target: ApiClient) => jest.spyOn(target, 'get').mockResolvedValue({ data: { organization: { id: 'o', slug: 'acme' }, project: { id: 'p', slug: 'web' } }, status: 200, headers: new Headers() })
  it('refuses a config whose declared API origin differs from the active client', async () => {
    const active = new ApiClient({ baseUrl: 'https://prod.example.com' })
    const get = respond(active)
    await expect(verifyContext(active, config, false, 'https://staging.example.com')).rejects.toThrow('CONTEXT_MISMATCH')
    expect(get).not.toHaveBeenCalled()
  })
  it('accepts a matching origin or a config without a declared origin', async () => {
    const active = new ApiClient({ baseUrl: 'https://prod.example.com' })
    respond(active)
    await expect(verifyContext(active, config, false, 'https://prod.example.com/')).resolves.toMatchObject({ apiUrl: expect.stringContaining('prod.example.com') })
    await expect(verifyContext(active, config)).resolves.toBeDefined()
  })
})
describe('transcript-safe output', () => {
  it('keeps monitor URLs and non-credential headers visible while masking credential headers', () => {
    const monitor = { type: 'http_request', target: 'https://example.com/health', config: { url: 'https://example.com/health', headers: { Accept: 'text/html', Authorization: 'Bearer SENTINEL', 'X-Api-Token': 'SENTINEL' } } }
    const result = redact(monitor)
    expect(result.config.url).toBe('https://example.com/health')
    expect(result.config.headers.Accept).toBe('text/html')
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
  })
  it('does not rewrite script bodies or non-credential identity fields', () => {
    const input = { script: "await page.goto('https://app.example.com/cb?token=abc&x=1')", username: 'bob' }
    expect(redact(input)).toEqual(input)
  })
  it('masks signed monitor URLs and signature headers but not ordinary ones', () => {
    const monitor = { type: 'http_request', config: { url: 'https://example.com/h?sig=SENTINEL&ok=1', headers: { 'X-Signature': 'SENTINEL', 'X-Auth': 'SENTINEL', Accept: 'text/html' } } }
    const result = redact(monitor)
    expect(JSON.stringify(result)).not.toContain('SENTINEL')
    expect(result.config.headers.Accept).toBe('text/html')
  })
  it('masks basic-auth username inside provider configs', () => {
    expect(JSON.stringify(redact({ type: 'webhook', config: { username: 'SENTINEL' } }))).not.toContain('SENTINEL')
  })
  it('masks credentials embedded in messages and in script bodies', () => {
    const input = { message: 'Request to https://api.x.com/v1?token=SENTINEL failed', errorMessage: 'GET https://u:SENTINEL@host/ 500', script: "await page.goto('postgres://u:SENTINEL@db/x')" }
    expect(JSON.stringify(redact(input))).not.toContain('SENTINEL')
  })
  it('masks common credential key variants', () => {
    const input = { refreshToken: 'SENTINEL', webhookSecret: 'SENTINEL', smtpPassword: 'SENTINEL', 'X-Custom-Token': 'SENTINEL', smtpPass: 'SENTINEL', pwd: 'SENTINEL', cookies: 'SENTINEL' }
    expect(JSON.stringify(redact(input))).not.toContain('SENTINEL')
  })
  it('masks every provider credential field while preserving non-credential URLs', () => {
    const config = { webhookUrl: 'SENTINEL', discordWebhookUrl: 'SENTINEL', teamsWebhookUrl: 'SENTINEL', botToken: 'SENTINEL', url: 'https://example.com/SENTINEL', headers: { 'X-Custom': 'SENTINEL' } }
    const input = { type: 'webhook', config, url: 'https://example.com/public' }
    expect(JSON.stringify(redact(input))).not.toContain('SENTINEL')
    expect(redact(input).url).toBe(input.url)
    expect(config.headers['X-Custom']).toBe('SENTINEL')
    setRevealSecrets(true)
    expect(redact(input)).toBe(input)
  })
  it('masks normalized credential headers, provider fields, secret variables and credential URLs', () => {
    const input = { headers: { 'Proxy-Authorization': 'Basic SENTINEL', 'Set-Cookie': 'session=SENTINEL', 'X-Auth-Token': 'SENTINEL', access_token: 'SENTINEL' }, config: { webhookUrl: 'https://example.com/SENTINEL' }, variables: [{ key: 'PASSWORD', isSecret: true, value: 'SENTINEL' }], target: 'https://user:SENTINEL@example.com?api_key=SENTINEL' }
    expect(JSON.stringify(redact(input))).not.toContain('SENTINEL')
    expect(input.headers['Set-Cookie']).toContain('SENTINEL')
    setRevealSecrets(true)
    expect(redact(input)).toBe(input)
  })
})

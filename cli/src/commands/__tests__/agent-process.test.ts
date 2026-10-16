import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { mkdtempSync, existsSync, writeFileSync, readFileSync, readdirSync, realpathSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = process.env.SUPERCHECK_TEST_CLI_ENTRY ?? fileURLToPath(new URL('../../bin/supercheck.ts', import.meta.url))
let cwd: string
let testToken: string
const id = '019a1234-1234-7123-8123-123456789abc'
type Fixture = { requests: { method: string; path: string; body?: Record<string, unknown>; usingDotenvToken?: boolean }[]; resources: Record<string, Record<string, unknown>[]>; mode?: string }
const read = (): Fixture => JSON.parse(readFileSync(resolve(cwd, 'fixture.json'), 'utf8'))
function fixture(mode?: string) { writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify({ requests: [], resources: {}, mode })) }
function config(value: Record<string, unknown> = {}) {
  writeFileSync(resolve(cwd, 'supercheck.config.mjs'), `export default ${JSON.stringify({ schemaVersion: '1.0', project: { organization: 'org', project: 'project' }, ...value })}`)
}
function run(...args: string[]) {
  return runWithOutput(true, ...args)
}
function runWithOutput(json: boolean, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve(cwd, 'fetch.mjs'), entry, ...(json ? ['--json'] : []), ...args], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SUPERCHECK_TOKEN: testToken, SUPERCHECK_TRIGGER_KEY: 'sck_trigger_fake_for_tests', SUPERCHECK_URL: 'https://mock.invalid', CLI_TEST_CWD: cwd },
  })
}
beforeEach(() => {
  cwd = mkdtempSync(resolve(tmpdir(), 'supercheck-process-'))
  testToken = 'sck_live_fake_token_for_tests'
  fixture(); config(); writeFileSync(resolve(cwd, 'package.json'), '{"type":"module"}')
  mkdirSync(resolve(cwd, 'node_modules/@supercheck/cli'), { recursive: true })
  writeFileSync(resolve(cwd, 'node_modules/@supercheck/cli/package.json'), '{"type":"module","exports":"./index.js"}')
  writeFileSync(resolve(cwd, 'node_modules/@supercheck/cli/index.js'), 'export const defineConfig = value => value;')
  writeFileSync(resolve(cwd, 'fetch.mjs'), `
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
process.chdir(process.env.CLI_TEST_CWD);
const path=join(process.cwd(),'fixture.json');
if(JSON.parse(readFileSync(path,'utf8')).mode==='dotenv-token')delete process.env.SUPERCHECK_TOKEN;
globalThis.fetch=async (url,options={})=>{
 const state=JSON.parse(readFileSync(path,'utf8'));
 const route=new URL(url).pathname,method=options.method??'GET',body=options.body?JSON.parse(options.body):undefined;
 state.requests.push({path:route,method,body,usingDotenvToken:new Headers(options.headers).get('authorization')==='Bearer sck_live_from_dotenv_for_tests'});
 let data={},status=200;
 const context={organization:{id:'org'},project:{id:state.mode==='wrong-context'?'other-project':'project'},user:{id:'user',role:'project_admin'}};
 if(state.mode==='script-denied'&&route==='/api/tests/${id}'){status=403;data={error:'denied'};}
 else if(state.mode==='swapped-test'&&route==='/api/tests/${id}'){data={id:'019a9999-0000-7000-8000-000000000009',title:'Other',type:'browser',script:'x'};}
 else if(route==='/api/context')data=context;
 else if(route==='/api/health')data={status:'ok'};
 else if(state.mode==='provider-denied'&&route==='/api/notification-providers'){status=403;data={error:'denied',config:{discordWebhookUrl:'LEAK_TEST_DISCORD',teamsWebhookUrl:'LEAK_TEST_TEAMS',url:'LEAK_TEST_URL',headers:{'X-Custom':'LEAK_TEST_HEADERS'}}};}
 else if(state.mode==='inventory-denied'&&route==='/api/jobs'){status=403;data={error:'denied'};}
 else if(route==='/api/validate-script')data={valid:true};
 else if(route.endsWith('/trigger')||route.endsWith('/execute'))data={runId:'${id}'};
 else if(route.endsWith('/stream')){writeFileSync(path,JSON.stringify(state));return new Response('event: status\\ndata: {"status":"running"}\\n\\n',{headers:{'content-type':'text/event-stream'}});}
 else if(route.startsWith('/api/runs/'))data={id:'${id}',status:'passed'};
 else if(method==='POST'){
  const items=state.resources[route]??=[];
  const created={...body,id:'019a1234-1234-7123-8123-'+String(items.length+1).padStart(12,'0')};
  if(route==='/api/jobs'&&body.tests.some(t=>t.id.includes('/'))){status=400;data={error:'Path is not a test UUID'};}
  else{items.push(created);data=route==='/api/tests'?{test:created}:route==='/api/jobs'?{job:created}:created;}
 }else if(method==='PUT'){
  const collection=route.substring(0,route.lastIndexOf('/')),id=route.substring(route.lastIndexOf('/')+1);
  const item=state.resources[collection]?.find(item=>item.id===id);
  if(item){Object.assign(item,body);data=item;}else{status=404;data={error:'not found'};}
 }else if(method==='DELETE'){state.resources[route.substring(0,route.lastIndexOf('/'))]=[];data={success:true};}
 else{
  const items=state.resources[route]??[];
  data=['/api/variables','/api/tags','/api/notification-providers'].includes(route)?items:{data:items,pagination:{page:1,total:items.length,totalPages:state.mode==='paged'?3:1}};
 }
 writeFileSync(path,JSON.stringify(state));return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};`)
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

describe('CLI agent workflows through the real entrypoint', () => {
  it('rejects a different project before sending mutations', () => {
    fixture('wrong-context')
    const result = run('deploy', '--force')
    expect(result.status).toBe(3); expect(JSON.parse(result.stderr).code).toBe('CONTEXT_MISMATCH')
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })
  it('persists identity and makes repeat deployment a no-op', () => {
    config({ monitors: [{ name: 'API', type: 'http_request', target: 'https://example.com', frequencyMinutes: 5 }] })
    const first = run('deploy', '--force'); expect(first.status).toBe(0); expect(JSON.parse(first.stdout).results[0].id).toBeTruthy()
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
    expect(read().requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })
  it('creates tests before dependent jobs and preserves original local paths', () => {
    const path = '_supercheck_/playwright/homepage.pw.ts'; mkdirSync(resolve(cwd, '_supercheck_/playwright'), { recursive: true })
    writeFileSync(resolve(cwd, path), "import {test} from '@playwright/test'; test('home',async()=>{});")
    config({ tests: { playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts' } }, jobs: [{ name: 'Nightly', tests: [path] }] })
    const result = run('deploy', '--force'); expect(result.status).toBe(0)
    const writes = read().requests.filter((request) => request.method === 'POST' && request.path !== '/api/validate-script')
    expect(writes.map((request) => request.path)).toEqual(['/api/tests', '/api/jobs'])
    expect(writes[1].body?.tests).toEqual([{ id: '019a1234-1234-7123-8123-000000000001' }])
    expect(readFileSync(resolve(cwd, path), 'utf8')).toContain("test('home'")
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
  })
  it('returns a visible preview and refuses non-interactive confirmation', () => {
    config({ monitors: [{ name: 'API', type: 'http_request', target: 'https://example.com' }] })
    const preview = run('diff'); expect(preview.status).toBe(0); expect(JSON.parse(preview.stdout).changes[0].action).toBe('create')
    const refused = run('deploy'); expect(refused.status).toBe(3); expect(JSON.parse(refused.stderr).code).toBe('CONFIRMATION_REQUIRED')
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })
  it('validates wait arguments before triggering', () => {
    const result = run('job', 'trigger', id, '--wait', '--timeout', 'bad')
    expect(result.status).toBe(3); expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })
  it('returns an accepted run ID and supports resuming a bounded wait', () => {
    const result = run('job', 'trigger', id); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).runId).toBe(id)
    const wait = run('run', 'wait', id); expect(wait.status).toBe(0); expect(JSON.parse(wait.stdout).status).toBe('passed')
  })
  it('fails closed on incomplete destruction inventory', () => {
    fixture('inventory-denied')
    const result = run('destroy', '--force'); expect(result.status).not.toBe(0)
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })
  it('treats a disconnected running stream as incomplete', () => {
    const result = run('run', 'stream', id); expect(result.status).toBe(4)
    expect(JSON.parse(result.stderr).error).toContain('before the server reported completion')
  })
  it('preserves legacy arrays and exposes pagination with --envelope', () => {
    fixture('paged')
    expect(JSON.parse(run('monitor', 'list').stdout)).toEqual([])
    expect(JSON.parse(run('--envelope', 'monitor', 'list').stdout)).toMatchObject({ data: [], pagination: { totalPages: 3 } })
  })
  it('prints versioned guidance without executing repository config', () => {
    writeFileSync(resolve(cwd, 'supercheck.config.mjs'), "throw new Error('must not execute')")
    const result = run('skills', 'sync'); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).content).toContain('supercheck.state.json')
    expect(read().requests).toEqual([])
  })
  it('rejects schema typos and redacts provider credentials unless deliberately revealed', () => {
    config({ notifcationProviders: [] })
    expect(run('config', 'validate').status).toBe(3)
    config({ notificationProviders: [{ name: 'Slack', type: 'slack', config: { webhookUrl: 'https://hooks.example.com/SECRET_REVIEW_SENTINEL' } }] })
    expect(run('config', 'print').stdout).not.toContain('SECRET_REVIEW_SENTINEL')
    expect(run('--show-secrets', 'config', 'print').stdout).toContain('SECRET_REVIEW_SENTINEL')
  })
  it('backs up edited config and returns one JSON pull summary', () => {
    config({ monitors: [{ name: 'Local edit', type: 'http_request' }] })
    const before = readFileSync(resolve(cwd, 'supercheck.config.mjs'), 'utf8')
    const state = read(); state.resources['/api/monitors'] = [{ id, name: 'Remote', type: 'http_request' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const result = run('pull', '--config-only', '--force', '--skip-install')
    expect(result.status).toBe(0)
    const summary = JSON.parse(result.stdout)
    expect(summary.backups).toHaveLength(1)
    expect(readFileSync(summary.backups[0], 'utf8')).toBe(before)
    expect(summary.files).toContain(realpathSync(resolve(cwd, 'supercheck.config.mjs')))
  })
  it('returns nonzero when a remote script cannot be copied', () => {
    fixture('script-denied')
    const state = read(); state.resources['/api/tests'] = [{ id, title: 'Unavailable', type: 'browser' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const result = run('pull', '--tests-only', '--force')
    expect(result.status).not.toBe(0)
    expect(JSON.parse(result.stdout).status).toBe('partial')
  })

  it('refuses a pull when the server returns a test ID that is not a UUID, writing nothing', () => {
    fixture()
    const state = read(); state.resources['/api/tests'] = [{ id: 'a.b/../../../../evil', title: 'Evil', type: 'browser', script: 'x' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const result = run('pull', '--tests-only', '--force')
    expect(result.status).not.toBe(0)
    expect(existsSync(resolve(cwd, '_supercheck_'))).toBe(false)
    expect(existsSync(resolve(cwd, '..', 'evil.pw.ts'))).toBe(false)
  })

  it('writes a hostile test title as a single comment line without altering the script', () => {
    fixture()
    const title = "Evil\nrequire('fs').rmSync('x')\n*/ $& $1"
    const state = read(); state.resources['/api/tests'] = [{ id, title, type: 'browser', script: 'await page.goto("/")' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    expect(run('pull', '--tests-only', '--force', '--skip-install').status).toBe(0)
    const dir = resolve(cwd, '_supercheck_/playwright')
    const file = readdirSync(dir).find((name) => name.endsWith('.pw.ts'))!
    const lines = readFileSync(resolve(dir, file), 'utf8').split('\n')
    expect(lines[0].startsWith('// @title Evil ')).toBe(true)
    expect(lines.some((line) => line.startsWith("require("))).toBe(false)
    expect(lines).toContain('await page.goto("/")')
  })

  it('aborts the whole pull when the per-test response is a different test', () => {
    fixture('swapped-test')
    const state = read(); state.resources['/api/tests'] = [{ id, title: 'A', type: 'browser' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const result = run('pull', '--tests-only', '--force', '--skip-install')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('different test than requested')
    expect(existsSync(resolve(cwd, '_supercheck_/playwright'))).toBe(false)
  })

  it('shows the individual failures when a human-mode pull is partial', () => {
    fixture('script-denied')
    const state = read(); state.resources['/api/tests'] = [{ id, title: 'Unavailable', type: 'browser' }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const result = runWithOutput(false, 'pull', '--tests-only', '--force', '--skip-install')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('test "Unavailable":')
    expect(result.stderr).toContain('403')
    expect(result.stderr).toContain('Pull incomplete: 1 error(s)')
  })

  it('redacts all provider credentials in config, plans, and API errors', () => {
    const provider = { id, name: 'Hook', type: 'webhook', config: { webhookUrl: 'LEAK_TEST_SLACK', discordWebhookUrl: 'LEAK_TEST_DISCORD', teamsWebhookUrl: 'LEAK_TEST_TEAMS', url: 'LEAK_TEST_URL', headers: { 'X-Custom': 'LEAK_TEST_HEADERS' } } }
    config({ notificationProviders: [provider] })
    const state = read(); state.resources['/api/notification-providers'] = [{ ...provider, config: {} }]
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    for (const args of [['config', 'print'], ['diff'], ['deploy', '--dry-run']]) {
      const result = run(...args)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[REDACTED]')
      expect(result.stdout + result.stderr).not.toContain('LEAK_TEST_')
    }
    expect(run('--show-secrets', 'config', 'print').stdout).toContain('LEAK_TEST_DISCORD')
    fixture('provider-denied')
    for (const json of [true, false]) {
      const result = runWithOutput(json, 'notification', 'list')
      expect(result.status).toBe(4)
      expect(result.stderr).toContain('[REDACTED]')
      expect(result.stdout + result.stderr).not.toContain('LEAK_TEST_')
    }
  })

  it('keeps diagnostic commands usable when project config cannot load', () => {
    writeFileSync(resolve(cwd, 'supercheck.config.mjs'), "throw new Error('bad project config')")
    for (const args of [['whoami'], ['health'], ['locations'], ['capabilities', '--online']]) {
      const result = run(...args)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    }
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
    expect(run('deploy', '--force').status).not.toBe(0)
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('requires a config file for offline config commands while retaining no-config local execution', () => {
    rmSync(resolve(cwd, 'supercheck.config.mjs'))
    for (const action of ['validate', 'print']) {
      const result = run('config', action, '--offline')
      expect(result.status).toBe(3)
      expect(JSON.parse(result.stderr).error).toContain('No supercheck.config.ts found')
    }
    const result = run('test', 'run', '--offline', '--file', 'missing.pw.ts')
    expect(result.status).toBe(3)
    expect(JSON.parse(result.stderr).error).toContain('Cannot read local test')
    expect(read().requests).toEqual([])
  })

  it('loads diagnostic credentials from dotenv without executing broken project config', () => {
    fixture('dotenv-token')
    writeFileSync(resolve(cwd, '.env'), 'SUPERCHECK_TOKEN=sck_live_from_dotenv_for_tests\n')
    writeFileSync(resolve(cwd, 'supercheck.config.mjs'), "throw new Error('must not execute config')")
    for (const args of [['whoami'], ['locations'], ['capabilities', '--online']]) expect(run(...args).status).toBe(0)
    expect(read().requests.length).toBeGreaterThan(0)
    expect(read().requests.every((request) => request.usingDotenvToken)).toBe(true)
    fixture()
    expect(run('whoami').status).toBe(0)
    expect(read().requests.every((request) => !request.usingDotenvToken)).toBe(true)
  })

  it('releases the old name after an explicit-ID rename without adopting a later definition', () => {
    config({ monitors: [{ name: 'Old', type: 'http_request' }] })
    const first = run('deploy', '--force'); expect(first.status).toBe(0)
    const createdId = JSON.parse(first.stdout).results[0].id
    config({ monitors: [{ id: createdId, name: 'Renamed', type: 'http_request' }] })
    expect(run('deploy', '--force').status).toBe(0)
    config({ monitors: [{ id: createdId, name: 'Renamed', type: 'http_request' }, { name: 'Old', type: 'http_request' }] })
    const next = run('deploy', '--force'); expect(next.status).toBe(0)
    expect(JSON.parse(next.stdout).results[0]).toMatchObject({ action: 'create', name: 'Old' })
    expect(read().resources['/api/monitors'].map((resource) => resource.name)).toEqual(['Renamed', 'Old'])
    expect(JSON.parse(run('deploy', '--force').stdout).status).toBe('no_change')
  })
  it('checks configured targets for direct resource writes too', () => {
    fixture('wrong-context')
    const result = run('monitor', 'delete', id, '--force')
    expect(result.status).toBe(3)
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('normalizes synthetic-monitor references before the second deployment', () => {
    const path = '_supercheck_/playwright/homepage.pw.ts'; mkdirSync(resolve(cwd, '_supercheck_/playwright'), { recursive: true })
    writeFileSync(resolve(cwd, path), "import {test} from '@playwright/test'; test('home',async()=>{});")
    config({ tests: { playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts' } }, monitors: [{ name: 'Synthetic', type: 'synthetic_test', config: { testId: path } }] })
    expect(run('deploy', '--force').status).toBe(0)
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
    expect(read().requests.filter((request) => ['POST', 'PUT'].includes(request.method) && request.path !== '/api/validate-script')).toHaveLength(2)
  })

  it('retains replacement IDs when an explicitly managed remote resource was deleted', () => {
    config({ monitors: [{ id, name: 'Recreated', type: 'http_request' }] })
    expect(run('deploy', '--force').status).toBe(0)
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
    expect(read().requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    const state = read(); state.resources['/api/monitors'] = []; writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    expect(run('deploy', '--force').status).toBe(0)
    expect(JSON.parse(run('deploy', '--force').stdout).status).toBe('no_change')
  })
  it('preserves deployed idless script paths across a subsequent pull', () => {
    const path = '_supercheck_/playwright/homepage.pw.ts'; mkdirSync(resolve(cwd, '_supercheck_/playwright'), { recursive: true })
    writeFileSync(resolve(cwd, path), "import {test} from '@playwright/test'; test('home',async()=>{});")
    config({ tests: { playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts' } }, jobs: [{ name: 'Nightly', tests: [path] }] })
    expect(run('deploy', '--force').status).toBe(0)
    const pulled = run('pull', '--force'); expect(pulled.status).toBe(0)
    expect(readFileSync(resolve(cwd, path), 'utf8')).toContain('@title')
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
  })

  it('reaches local validation without authentication or API requests in offline mode', () => {
    testToken = 'invalid'
    const result = run('test', 'run', '--offline', '--file', 'missing.pw.ts')
    expect(result.status).toBe(3)
    expect(JSON.parse(result.stderr).error).toContain('Cannot read local test')
    expect(read().requests).toEqual([])
  })

  it('rejects local job script-type mismatches without credentials or network', () => {
    testToken = 'invalid'
    const path = '_supercheck_/playwright/wrong.pw.ts'
    mkdirSync(resolve(cwd, '_supercheck_/playwright'), { recursive: true })
    writeFileSync(resolve(cwd, path), "import {check} from 'k6'; export default function(){}")
    config({ jobs: [{ name: 'Offline', tests: [path] }] })
    const result = run('job', 'run', '--id', 'Offline', '--local', '--offline')
    expect(result.status).toBe(3)
    expect(JSON.parse(result.stderr).error).toContain('k6')
    expect(read().requests).toEqual([])
  })

  it('migrates a managed script when its remote runner type changes', () => {
    const path = '_supercheck_/playwright/homepage.pw.ts'; mkdirSync(resolve(cwd, '_supercheck_/playwright'), { recursive: true })
    writeFileSync(resolve(cwd, path), "import {test} from '@playwright/test'; test('home',async()=>{});")
    config({ tests: { playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts' } } })
    expect(run('deploy', '--force').status).toBe(0)
    const state = read(); state.resources['/api/tests'][0].type = 'performance'
    state.resources['/api/tests'][0].script = Buffer.from("import {check} from 'k6'; export default function(){check(1,{ok:v=>v===1});}").toString('base64')
    writeFileSync(resolve(cwd, 'fixture.json'), JSON.stringify(state))
    const pulled = run('pull', '--force'); expect(pulled.status).toBe(0)
    expect(existsSync(resolve(cwd, path))).toBe(false)
    const summary = JSON.parse(pulled.stdout)
    expect(summary.files.some((file: string) => file.endsWith('.k6.ts'))).toBe(true)
    expect(summary.backups.some((file: string) => file.includes('homepage.pw.ts.supercheck-backup.'))).toBe(true)
    expect(JSON.parse(run('deploy', '--force').stdout).status).toBe('no_change')
  })

  it('does not redeploy non-secret providers, tags, or variables after creating them', () => {
    config({ notificationProviders: [{ name: 'Email', type: 'email', config: { recipients: ['ops@example.com'] } }], tags: [{ name: 'prod' }], variables: [{ key: 'REGION', value: 'local' }] })
    expect(run('deploy', '--force').status).toBe(0)
    const second = run('deploy', '--force'); expect(second.status).toBe(0); expect(JSON.parse(second.stdout).status).toBe('no_change')
    expect(read().requests.filter((request) => request.method === 'POST')).toHaveLength(3)
  })
  it('refuses unsupported resource tag assignments rather than silently ignoring them', () => {
    config({ monitors: [{ name: 'API', type: 'http_request', tags: ['prod'] }] })
    const result = run('deploy', '--force'); expect(result.status).toBe(3)
    expect(JSON.parse(result.stderr).error).toContain('not supported')
    expect(read().requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('installs a small skill pointer and refuses to overwrite it without force', () => {
    const first = run('skills', 'install'); expect(first.status).toBe(0)
    const path = JSON.parse(first.stdout).path
    writeFileSync(path, 'User-maintained instructions')
    expect(run('skills', 'install').status).toBe(3)
    expect(readFileSync(path, 'utf8')).toBe('User-maintained instructions')
  })
  it('describes schema and capabilities without cloud access by default', () => {
    expect(JSON.parse(run('schema', 'config').stdout).schema.properties.project).toBeTruthy()
    const offline = JSON.parse(run('capabilities').stdout)
    expect(offline.contextVerified).toBe(false); expect(read().requests).toEqual([])
    const online = JSON.parse(run('capabilities', '--online').stdout)
    expect(online.contextVerified).toBe(true)
    expect(read().requests.filter((request) => request.path === '/api/context')).toHaveLength(1)
  })
  it('executes one deployed test and returns its accepted run ID', () => {
    const result = run('test', 'execute', id)
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).runId).toBe(id)
    expect(read().requests.filter((request) => request.method === 'POST').map((request) => request.path)).toEqual(['/api/tests/' + id + '/execute'])
  })

})

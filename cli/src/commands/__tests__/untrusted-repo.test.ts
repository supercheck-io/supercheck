import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installAgentSkill } from '../agent.js'
import { discoverRepository } from '../../utils/discover.js'

const entry = fileURLToPath(new URL('../../bin/supercheck.ts', import.meta.url))
const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))
// Resolve tsx from the CLI package, not from the (untrusted, temporary) repository under test.
const tsxLoader = pathToFileURL(join(cliRoot, 'node_modules/tsx/dist/loader.mjs')).href
let repo: string
let home: string
let server: Server
let legit: Server
let legitPort: number
let seen: { url: string; auth?: string }[]
let port: number

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'sc-hostile-'))
  home = mkdtempSync(join(tmpdir(), 'sc-home-'))
  seen = []
  server = createServer((req, res) => { seen.push({ url: req.url ?? '', auth: req.headers.authorization }); res.statusCode = 401; res.end('{}') })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
  // The user's genuine API target (a real environment variable), kept separate from the hostile one.
  legit = createServer((_req, res) => { res.statusCode = 401; res.end('{}') })
  await new Promise<void>((r) => legit.listen(0, '127.0.0.1', r))
  legitPort = (legit.address() as { port: number }).port
  // A hostile checkout: config that runs code, and a .env that redirects the API target.
  writeFileSync(join(repo, 'supercheck.config.ts'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(repo, 'PWNED'))}, 'config executed')\nexport default { schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, api: { baseUrl: 'http://127.0.0.1:${port}' } }\n`)
  writeFileSync(join(repo, '.env'), `SUPERCHECK_URL=http://127.0.0.1:${port}\nSUPERCHECK_TOKEN=sck_live_${'e'.repeat(32)}\n`)
  writeFileSync(join(repo, 'package.json'), '{}')
})
afterEach(async () => {
  await new Promise((r) => server.close(r))
  await new Promise((r) => legit.close(r))
  rmSync(repo, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true })
})

function run(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runWith(true, {}, ...args)
}
/**
 * `clean` runs have NO SUPERCHECK_URL / SUPERCHECK_TOKEN in the real environment, which is exactly when a hostile
 * repository .env would otherwise win. Without this the tests would pass vacuously (dotenv never overrides existing values).
 */
/** Like runClean but keeps a real token: the .env is then loaded for a config-declared server, which is where proxy settings would apply. */
function runClean_withToken(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runWith(true, { SUPERCHECK_URL: undefined }, ...args)
}
function runClean(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runWith(true, { SUPERCHECK_URL: undefined, SUPERCHECK_TOKEN: undefined }, ...args)
}
function runWith(json: boolean, patch: Record<string, string | undefined>, ...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), SUPERCHECK_URL: `http://127.0.0.1:${legitPort}`, SUPERCHECK_TOKEN: `sck_live_${'a'.repeat(32)}`, NODE_PATH: join(cliRoot, 'node_modules'), ...patch }
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
    const child = spawn(process.execPath, ['--import', tsxLoader, entry, ...(json ? ['--json'] : []), ...args], {
      cwd: repo,
      env: env as NodeJS.ProcessEnv,
    })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', (d) => (stdout += d)); child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('inspection commands on an untrusted checkout', () => {
  it.each([
    [['discover']],
    [['onboard']],
    [['plan']],
    [['agent', 'install']],
    [['ci', 'init', '--github']],
    [['doctor']],
  ])('%j never executes repository config or reads its .env', async (args) => {
    const result = await run(...args)
    // Guard against a vacuous pass: the command must actually have started and produced output.
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/)
    expect(result.stdout + result.stderr).not.toBe('')
    expect(existsSync(join(repo, 'PWNED'))).toBe(false)
    // Neither the repo .env nor the config may redirect where a token is sent.
    expect(seen.filter((r) => r.auth?.includes('e'.repeat(32)))).toEqual([])
    expect(seen).toEqual([])
  }, 30000)
})

describe('cloud commands on an untrusted checkout', () => {
  it.each([
    [['whoami']],
    [['locations']],
    [['test', 'list']],
  ])('%j never sends a token to a URL or with a credential taken from the repo .env', async (args) => {
    // The hostile .env sets both the token and the API target; the real environment sets neither.
    const result = await runClean(...args)
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/)
    expect(result.stdout + result.stderr).not.toBe('')
    expect(seen.filter((r) => r.auth?.includes('e'.repeat(32)))).toEqual([])
    // Nothing reached the hostile server named in .env.
    expect(seen).toEqual([])
  }, 30000)

  it('never lets a .env route requests through its proxy or weaken TLS', async () => {
    // The project config names the legitimate loopback server (so the .env is genuinely loaded for this command),
    // and the real environment supplies only the token. The hostile .env points both proxy variables at the listener
    // that records `seen`; if they were applied, the request to the legitimate server would be forwarded through it.
    writeFileSync(join(repo, 'supercheck.config.ts'), `export default { schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, api: { baseUrl: 'http://127.0.0.1:${legitPort}' } }\n`)
    writeFileSync(join(repo, '.env'), `HTTP_PROXY=http://127.0.0.1:${port}\nhttp_proxy=http://127.0.0.1:${port}\nHTTPS_PROXY=http://127.0.0.1:${port}\nNODE_TLS_REJECT_UNAUTHORIZED=0\n`)
    const result = await runClean_withToken('test', 'list')
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find/)
    // The command really ran and reached the legitimate server (it answers 401), rather than being short-circuited.
    expect(result.stdout + result.stderr).toMatch(/401|TOKEN_INVALID|Invalid or expired/)
    expect(seen).toEqual([])
  }, 30000)
})

describe('warning for ignored .env credentials', () => {
  it('tells the user which variables were ignored and how to supply them', async () => {
    const result = await runWith(false, { SUPERCHECK_URL: undefined, SUPERCHECK_TOKEN: undefined }, 'locations')
    expect(result.stderr).toMatch(/Ignoring SUPERCHECK_URL, SUPERCHECK_TOKEN from \.env|Ignoring SUPERCHECK_TOKEN, SUPERCHECK_URL from \.env/)
    expect(result.stderr).toMatch(/supercheck login/)
  }, 30000)
})

describe('marker block handling', () => {
  const write = (text: string) => writeFileSync(join(repo, 'AGENTS.md'), text)
  it('refuses stray, duplicated, reversed or quoted markers instead of deleting user text', () => {
    const cases = [
      '<!-- supercheck:begin -->\nMY RULES\n<!-- supercheck:begin -->\nx\n<!-- supercheck:end -->\n',
      '<!-- supercheck:end -->\nrules\n<!-- supercheck:begin -->\n',
      'Use `<!-- supercheck:begin -->` in docs\n',
    ]
    for (const text of cases) {
      write(text)
      expect(() => installAgentSkill({ target: 'generic', cwd: repo, pointer: 'AGENTS.md', force: true })).toThrow(/unexpected supercheck markers/)
      expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toBe(text)
    }
  })
})

describe('discover with hostile names', () => {
  it('omits devCommand for unsafe directory names', () => {
    mkdirSync(join(repo, 'apps/x;touch pwned'), { recursive: true })
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }))
    writeFileSync(join(repo, 'apps/x;touch pwned/package.json'), JSON.stringify({ dependencies: { next: '15' }, scripts: { dev: 'next dev' } }))
    const facts = discoverRepository(repo)
    expect(facts.app.devCommand).toBeNull()
    expect(facts.warnings.join(' ')).toMatch(/devCommand omitted/)
  })
})

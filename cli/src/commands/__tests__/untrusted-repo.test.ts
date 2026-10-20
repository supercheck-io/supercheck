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
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, entry, '--json', ...args], {
      cwd: repo,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), SUPERCHECK_URL: `http://127.0.0.1:${legitPort}`, SUPERCHECK_TOKEN: `sck_live_${'a'.repeat(32)}`, NODE_PATH: join(cliRoot, 'node_modules') },
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

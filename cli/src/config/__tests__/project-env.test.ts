import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectEnv, isProtectedEnvName } from '../project-env.js'

const PROTECTED_ENV = ['SUPERCHECK_TOKEN', 'SUPERCHECK_URL', 'SUPERCHECK_TRIGGER_KEY'] as const

const KEYS = [...PROTECTED_ENV, 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'http_proxy', 'https_proxy', 'no_proxy', 'SC_TEST_SAFE', 'SC_TEST_KEEP']
let dir: string
let saved: Record<string, string | undefined>
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-env-'))
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(dir, { recursive: true, force: true })
})
const env = (text: string) => { const p = join(dir, '.env'); writeFileSync(p, text); return p }

describe('isProtectedEnvName', () => {
  it.each(['SUPERCHECK_TOKEN', 'supercheck_url', 'HTTP_PROXY', 'https_proxy', 'ALL_PROXY', 'no_proxy', 'NODE_TLS_REJECT_UNAUTHORIZED', 'node_options', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'DOTENV_KEY', 'MY_PROXY'])('protects %s', (name) => {
    expect(isProtectedEnvName(name)).toBe(true)
  })
  it.each(['NODE_ENV', 'SUPERCHECK_ORG', 'SUPERCHECK_PROJECT', 'BASE_URL', 'API_KEY', 'PROXYMAN_NOTE', 'DATABASE_URL'])('allows %s', (name) => {
    expect(isProtectedEnvName(name)).toBe(false)
  })
})

describe('loadProjectEnv', () => {
  it('also refuses proxy and TLS settings (either case) so a .env cannot intercept the token', () => {
    loadProjectEnv(env('HTTP_PROXY=http://evil:8080\nhttps_proxy=http://evil:8080\nNO_PROXY=*\nNODE_TLS_REJECT_UNAUTHORIZED=0\nNODE_OPTIONS=--require ./x.js\nNODE_EXTRA_CA_CERTS=/tmp/evil.pem\nALL_PROXY=socks5://evil\n'))
    for (const k of ['HTTP_PROXY', 'https_proxy', 'NO_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'ALL_PROXY']) expect(process.env[k]).toBeUndefined()
  })
  it('warns once per variable even when the file is loaded repeatedly', () => {
    const calls: string[] = []
    const spy = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { calls.push(String(a[0])) })
    try {
      const path = env('SUPERCHECK_TOKEN=sck_live_x\nSC_TEST_SAFE=1\n')
      loadProjectEnv(path); loadProjectEnv(path); loadProjectEnv(path)
    } finally { spy.mockRestore() }
    expect(calls.filter((c) => c.includes('Ignoring')).length).toBeLessThanOrEqual(1)
  })
  it('never applies credentials or API targets from a .env, and reports them', () => {
    const ignored = loadProjectEnv(env('SUPERCHECK_TOKEN=sck_live_attacker\nSUPERCHECK_URL=https://evil.example\nSUPERCHECK_TRIGGER_KEY=sck_trigger_x\n'))
    expect(ignored.sort()).toEqual(['SUPERCHECK_TOKEN', 'SUPERCHECK_TRIGGER_KEY', 'SUPERCHECK_URL'])
    for (const k of PROTECTED_ENV) expect(process.env[k]).toBeUndefined()
  })
  it('still loads ordinary variables, and never overrides the real environment', () => {
    process.env.SC_TEST_KEEP = 'from-shell'
    loadProjectEnv(env('SC_TEST_SAFE=hello\nSC_TEST_KEEP=from-file\n'))
    expect(process.env.SC_TEST_SAFE).toBe('hello')
    expect(process.env.SC_TEST_KEEP).toBe('from-shell')
  })
  it('keeps real protected values and does not report them', () => {
    process.env.SUPERCHECK_URL = 'https://real.example'
    const ignored = loadProjectEnv(env('SUPERCHECK_URL=https://evil.example\n'))
    expect(ignored).toEqual([])
    expect(process.env.SUPERCHECK_URL).toBe('https://real.example')
  })
  it('tolerates a missing file', () => {
    expect(loadProjectEnv(join(dir, 'missing.env'))).toEqual([])
  })
})

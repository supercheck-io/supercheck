import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectEnv, PROTECTED_ENV } from '../project-env.js'

const KEYS = [...PROTECTED_ENV, 'SC_TEST_SAFE', 'SC_TEST_KEEP']
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

describe('loadProjectEnv', () => {
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

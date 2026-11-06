import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const warn = jest.fn<(message: string) => void>()
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { warn, debug: jest.fn(), info: jest.fn(), error: jest.fn() } }))
const { openConf } = await import('../open-conf.js')
const { authConfOptions } = await import('../store-options.js')
const { createPendingStore } = await import('../pending-device.js')

let cwd: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'supercheck-conf-')); warn.mockClear() })
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

describe('openConf', () => {
  it('leaves a valid file written with the real auth store options untouched', () => {
    const options = { ...authConfOptions, cwd }
    openConf(options).set({ token: 'sck_live_' + 'a'.repeat(32), baseUrl: 'https://app.example.com' })
    const before = readFileSync(join(cwd, 'config.json'))
    const reopened = openConf(options)
    expect(reopened.get('baseUrl')).toBe('https://app.example.com')
    expect(readFileSync(join(cwd, 'config.json')).equals(before)).toBe(true)
    expect(readdirSync(cwd)).toEqual(['config.json'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('moves a corrupt file aside, starts fresh and names the backup in the warning', () => {
    writeFileSync(join(cwd, 'config.json'), '{not json')
    const conf = openConf<{ token?: string }>({ ...authConfOptions, cwd })
    expect(conf.get('token')).toBeUndefined()
    const backup = readdirSync(cwd).find((name) => name.startsWith('config.json.corrupt-'))
    expect(backup).toBeDefined()
    expect(readFileSync(join(cwd, backup!), 'utf8')).toBe('{not json')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(join(cwd, backup!))
    expect(warn.mock.calls[0][0]).toContain('supercheck login')
  })

  it('also covers the pending device-login store', () => {
    writeFileSync(join(cwd, 'device-login.json'), '\u0000garbage')
    const store = createPendingStore({ cwd })
    expect(store.load()).toBeNull()
    expect(readdirSync(cwd).some((name) => name.startsWith('device-login.json.corrupt-'))).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })
  const unprivileged = process.platform !== 'win32' && process.getuid?.() !== 0
  ;(unprivileged ? it : it.skip)('rethrows a filesystem error and leaves the file in place', () => {
    const file = join(cwd, 'config.json')
    writeFileSync(file, '{}')
    chmodSync(file, 0o000)
    try {
      expect(() => openConf({ ...authConfOptions, cwd })).toThrow(/EACCES/)
    } finally { chmodSync(file, 0o600) }
    expect(readdirSync(cwd)).toEqual(['config.json'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('backs up a file that was written with a different encryption key', () => {
    openConf({ ...authConfOptions, cwd, encryptionKey: 'another-key' }).set('token', 'sck_live_' + 'a'.repeat(32))
    openConf({ ...authConfOptions, cwd })
    expect(readdirSync(cwd).some((name) => name.startsWith('config.json.corrupt-'))).toBe(true)
  })
})

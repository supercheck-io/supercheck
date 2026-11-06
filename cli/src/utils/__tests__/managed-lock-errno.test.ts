import { describe, it, expect, jest } from '@jest/globals'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const actualFs = await import('node:fs')
jest.unstable_mockModule('node:fs', () => ({
  ...actualFs,
  linkSync: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) },
}))
const { deploymentLock } = await import('../managed.js')

describe('deploymentLock', () => {
  it('surfaces a non-EEXIST link failure instead of reporting contention, and cleans up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'supercheck-lock-'))
    try {
      expect(() => deploymentLock(join(dir, 'supercheck.config.ts'))).toThrow('permission denied')
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

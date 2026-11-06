import { describe, it, expect } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openConf } from '../open-conf.js'

describe('openConf', () => {
  it('recovers from a corrupt config file instead of throwing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'supercheck-conf-'))
    try {
      writeFileSync(join(cwd, 'config.json'), '{not json')
      const conf = openConf<{ token?: string }>({ projectName: 'supercheck-cli', cwd })
      expect(conf.get('token')).toBeUndefined()
      conf.set('token', 'x')
      expect(conf.get('token')).toBe('x')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

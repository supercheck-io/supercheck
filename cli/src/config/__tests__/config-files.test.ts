import { describe, it, expect } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_FILES, LOCAL_CONFIG_FILES } from '../config-files.js'
import { LOCAL_CONFIG_FILES as LINK_LOCAL_FILES } from '../../utils/link-config.js'
import { discoverRepository } from '../../utils/discover.js'

describe('config file order', () => {
  it('is ts, js, mjs for main and local configs', () => {
    expect(CONFIG_FILES).toEqual(['supercheck.config.ts', 'supercheck.config.js', 'supercheck.config.mjs'])
    expect(LOCAL_CONFIG_FILES).toEqual(['supercheck.config.local.ts', 'supercheck.config.local.js', 'supercheck.config.local.mjs'])
    expect(LINK_LOCAL_FILES).toBe(LOCAL_CONFIG_FILES)
  })
  it('discover picks the same file the loader would when both .js and .mjs exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sc-config-order-'))
    try {
      writeFileSync(join(dir, 'supercheck.config.mjs'), 'export default {}')
      writeFileSync(join(dir, 'supercheck.config.js'), 'module.exports = {}')
      expect(discoverRepository(dir).existingTests.supercheck.config).toBe('supercheck.config.js')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

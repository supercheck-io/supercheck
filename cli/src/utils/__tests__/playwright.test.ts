import { describe, expect, it } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTempPlaywrightConfig } from '../playwright.js'

describe('selected local Playwright tests', () => {
  it('includes explicitly selected files outside the default discovery glob', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'supercheck-pw-config-'))
    const paths = [join(cwd, 'sample.pw.ts'), join(cwd, 'other.spec.ts')]
    const config = createTempPlaywrightConfig(cwd, paths, 'firefox')
    try {
      const source = readFileSync(config.path, 'utf8')
      expect(source).toContain(`testMatch: ${JSON.stringify(paths)}`)
      expect(source).toContain('browserName: "firefox"')
      expect(source).not.toContain('_supercheck_/playwright')
    } finally { config.cleanup(); rmSync(cwd, { recursive: true, force: true }) }
  })
})

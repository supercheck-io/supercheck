import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export type TempPlaywrightConfig = {
  path: string
  cleanup: () => void
}

export function createTempPlaywrightConfig(cwd: string, testMatch?: string): TempPlaywrightConfig {
  const dir = mkdtempSync(join(cwd, '.supercheck-playwright-'))
  const filePath = join(dir, 'playwright.supercheck.config.mjs')
  const match = testMatch ?? '_supercheck_/playwright/**/*.pw.ts'

  const contents = [
    "import { defineConfig } from '@playwright/test'",
    '',
    'export default defineConfig({',
    `  testDir: ${JSON.stringify(cwd)},`,
    `  testMatch: ${JSON.stringify([match])},`,
    '})',
    '',
  ].join('\n')

  writeFileSync(filePath, contents, 'utf-8')

  return {
    path: filePath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

import { CLIError, ExitCode } from './errors.js'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type TempPlaywrightConfig = {
  path: string
  cleanup: () => void
}

export function createTempPlaywrightConfig(cwd: string, testMatch?: string | string[], browser = 'chromium', configPath?: string): TempPlaywrightConfig {
  if (configPath) {
    const path = resolve(cwd, configPath)
    if (!existsSync(path)) throw new CLIError(`Playwright config not found: ${path}`, ExitCode.ConfigError)
    return { path, cleanup: () => undefined }
  }
  const dir = mkdtempSync(join(cwd, '.supercheck-playwright-'))
  const filePath = join(dir, 'playwright.supercheck.config.mjs')
  const match = testMatch ?? '_supercheck_/playwright/**/*.pw.ts'

  const contents = [
    "import { defineConfig } from '@playwright/test'",
    '',
    'export default defineConfig({',
    `  testDir: ${JSON.stringify(cwd)},`,
    `  outputDir: ${JSON.stringify(resolve(cwd, '.supercheck-artifacts'))},`,
    `  use: { browserName: ${JSON.stringify(browser)}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },`,
    `  testMatch: ${JSON.stringify(Array.isArray(match) ? match : [match])},`,
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

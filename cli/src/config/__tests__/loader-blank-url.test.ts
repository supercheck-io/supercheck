import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../loader.js'

let dir: string
let saved: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-loader-'))
  saved = process.env.SUPERCHECK_URL
})
afterEach(() => {
  if (saved === undefined) delete process.env.SUPERCHECK_URL
  else process.env.SUPERCHECK_URL = saved
  rmSync(dir, { recursive: true, force: true })
})

const writeConfig = () => writeFileSync(join(dir, 'supercheck.config.mjs'), `export default {
  schemaVersion: '1.0',
  api: { baseUrl: process.env.SUPERCHECK_URL ?? 'https://self.example.com' },
  project: { organization: 'o', project: 'p' },
}\n`)

describe('loadConfig SUPERCHECK_URL', () => {
  it('treats a blank value (unset CI variable) as unset', async () => {
    writeConfig()
    process.env.SUPERCHECK_URL = '  '
    const { config } = await loadConfig({ cwd: dir })
    expect(config.api?.baseUrl).toBe('https://self.example.com')
  })

  it('still lets a real value override the config', async () => {
    writeConfig()
    process.env.SUPERCHECK_URL = 'https://other.example.com'
    const { config } = await loadConfig({ cwd: dir })
    expect(config.api?.baseUrl).toBe('https://other.example.com')
  })
})

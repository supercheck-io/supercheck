import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveJobLocalTests } from '../jobs.js'

const pw = "import { test } from '@playwright/test'\ntest('x', async () => {})\n"
let dir: string
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'supercheck-job-skip-')))
  mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('local job run', () => {
  it('skips remote-only tests with a notice and keeps the others', () => {
    const put = (n: string, body: string) => writeFileSync(join(dir, '_supercheck_', 'playwright', n), body)
    put('a.pw.ts', pw)
    put('b.pw.ts', `// @type agent\n${pw}`)
    const refs = ['_supercheck_/playwright/a.pw.ts', '_supercheck_/playwright/b.pw.ts']
    expect(resolveJobLocalTests(dir, refs, { playwright: '_supercheck_/playwright/**/*.pw.ts' }).map((t) => t.name)).toEqual(['playwright/a.pw.ts'])
  })

  it('refuses a job whose tests all run remotely instead of running nothing', () => {
    writeFileSync(join(dir, '_supercheck_', 'playwright', 'c.pw.ts'), `// @type api\n${pw}`)
    expect(() => resolveJobLocalTests(dir, ['_supercheck_/playwright/c.pw.ts'], { playwright: '_supercheck_/playwright/**/*.pw.ts' })).toThrow(/run remotely/)
  })
})

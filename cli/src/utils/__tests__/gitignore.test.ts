import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureGitignoreEntries } from '../gitignore.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'supercheck-ignore-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
describe('ensureGitignoreEntries', () => {
  it('adds entries missing from a project initialized by an older CLI', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules\nsupercheck.config.local.ts\nsupercheck.config.local.js\nsupercheck.config.local.mjs')
    const added = ensureGitignoreEntries(dir)
    expect(added).toEqual(['supercheck.state.json.lock', '.supercheck-artifacts/', '*.supercheck-backup.*'])
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toContain('.supercheck-artifacts/')
    expect(ensureGitignoreEntries(dir)).toEqual([])
  })
  it('does not create a .gitignore', () => {
    expect(ensureGitignoreEntries(dir)).toEqual([])
    expect(existsSync(join(dir, '.gitignore'))).toBe(false)
  })
  it('recognises slash variants and preserves CRLF line endings', () => {
    writeFileSync(join(dir, '.gitignore'), '/.supercheck-artifacts\r\n*.supercheck-backup.*\r\n')
    const added = ensureGitignoreEntries(dir)
    expect(added).not.toContain('.supercheck-artifacts/')
    expect(added).not.toContain('*.supercheck-backup.*')
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(content.replace(/\r\n/g, '')).not.toContain('\n')
  })
})

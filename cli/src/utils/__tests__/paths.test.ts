import { describe, expect, it } from '@jest/globals'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isUuid, resolveWithin } from '../paths.js'

describe('isUuid', () => {
  it('accepts canonical UUIDs including v7', () => {
    expect(isUuid('019a1234-1234-7123-8123-000000000001')).toBe(true)
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(false)
  })
  it.each(['', 'x', '../../etc/passwd', 'a.b/../../../../tmp/evil', '019a1234-1234-7123-8123-000000000001/..', 42, null, undefined])('rejects %p', (value) => {
    expect(isUuid(value)).toBe(false)
  })
})
describe('resolveWithin', () => {
  it('resolves paths inside the root', () => {
    expect(resolveWithin('/proj', '_supercheck_/playwright/a.pw.ts')).toBe('/proj/_supercheck_/playwright/a.pw.ts')
  })
  it.each(['../evil.pw.ts', '_supercheck_/playwright/x/../../../../tmp/evil.pw.ts', '/etc/passwd', '.'])('refuses %s', (target) => {
    expect(() => resolveWithin('/proj', target)).toThrow('outside the project directory')
  })
  it('accepts in-project names that merely start with two dots', () => {
    expect(resolveWithin('/proj', '..foo/a.pw.ts')).toBe('/proj/..foo/a.pw.ts')
  })
  it('refuses a symlinked directory or file that leaves the root', () => {
    const base = mkdtempSync(join(tmpdir(), 'supercheck-paths-'))
    try {
      const root = join(base, 'proj'), outside = join(base, 'outside')
      mkdirSync(join(root, '_supercheck_'), { recursive: true }); mkdirSync(outside)
      symlinkSync(outside, join(root, '_supercheck_', 'playwright'))
      expect(() => resolveWithin(root, '_supercheck_/playwright/a.pw.ts')).toThrow('outside the project directory')
      mkdirSync(join(root, 'ok')); writeFileSync(join(outside, 'target'), 'x'); symlinkSync(join(outside, 'target'), join(root, 'ok', 'link.pw.ts'))
      expect(() => resolveWithin(root, 'ok/link.pw.ts')).toThrow('outside the project directory')
      expect(resolveWithin(root, 'ok/new.pw.ts')).toContain('new.pw.ts')
    } finally { rmSync(base, { recursive: true, force: true }) }
  })
})

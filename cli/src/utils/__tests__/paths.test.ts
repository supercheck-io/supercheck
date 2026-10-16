import { describe, expect, it } from '@jest/globals'
import { isUuid, resolveWithin } from '../paths.js'

describe('isUuid', () => {
  it('accepts canonical UUIDs including v7', () => {
    expect(isUuid('019a1234-1234-7123-8123-000000000001')).toBe(true)
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
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
})

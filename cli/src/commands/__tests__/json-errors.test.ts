import { describe, expect, it } from '@jest/globals'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../../bin/supercheck.ts', import.meta.url))
describe('nested command JSON failures', () => {
  it.each([
    ['incident', 'list', '--status', 'open'],
    ['incident', 'list', '--severity', 'bogus'],
    ['job', 'run'],
    ['job', 'run', '--id', ''],
    ['var', 'set', 'AB', 'value'],
    ['tag', 'create', 'AB'],
  ])('emits one JSON error for %s', (...args) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entry, '--json', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({ error: expect.any(String), exitCode: result.status })
  })
})

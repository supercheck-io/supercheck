import { describe, expect, it } from '@jest/globals'
import { resolveSpawn, runCommand } from '../exec.js'

describe('runCommand', () => {
  it('returns a non-zero exit code when the child is terminated by a signal', async () => {
    const code = await runCommand(process.execPath, [
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ])

    expect(code).not.toBe(0)
  })
})

// Windows is not available in CI here; the resolution logic is tested with injected platform/paths.
describe('resolveSpawn (Windows npx)', () => {
  const execPath = 'C:\\Program Files\\nodejs\\node.exe'

  it('runs npx-cli.js with node on win32 instead of the npx.cmd shim', () => {
    const r = resolveSpawn('npx', ['playwright', 'test'], 'win32', execPath, () => true)
    expect(r.executable).toBe(execPath)
    expect(r.args[0]).toMatch(/npx-cli\.js$/)
    expect(r.args.slice(1)).toEqual(['playwright', 'test'])
  })

  it('fails clearly when npx-cli.js is missing', () => {
    expect(() => resolveSpawn('npx', [], 'win32', execPath, () => false)).toThrow(/Could not find npx/)
  })

  it('leaves other commands and platforms untouched', () => {
    expect(resolveSpawn('npx', ['a'], 'linux', execPath)).toEqual({ executable: 'npx', args: ['a'] })
    expect(resolveSpawn('k6', ['run'], 'win32', execPath)).toEqual({ executable: 'k6', args: ['run'] })
  })
})

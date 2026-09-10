import { describe, expect, it } from '@jest/globals'
import { runCommand } from '../exec.js'

describe('runCommand', () => {
  it('returns a non-zero exit code when the child is terminated by a signal', async () => {
    const code = await runCommand(process.execPath, [
      '-e',
      "process.kill(process.pid, 'SIGTERM')",
    ])

    expect(code).not.toBe(0)
  })
})

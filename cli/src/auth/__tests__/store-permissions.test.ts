import { describe, it, expect } from '@jest/globals'
import { mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cliRoot = fileURLToPath(new URL('../../../', import.meta.url))

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]))
}

// Child process with a sandboxed HOME: the developer's real credentials are never read or written.
const suite = process.platform === 'win32' ? describe.skip : describe
suite('credential file permissions', () => {
  it('stores the CLI token and pending device grant owner-only', () => {
    const home = mkdtempSync(join(tmpdir(), 'supercheck-perms-'))
    try {
      const script = `
        const store = await import('./src/auth/store.ts')
        store.setCredentials('sck_live_' + 'a'.repeat(32), 'https://app.example.com')
        const { createPendingStore } = await import('./src/auth/pending-device.ts')
        createPendingStore().save({ apiUrl: 'https://app.example.com', clientId: 'supercheck-cli', deviceCode: 'x', userCode: 'BCDF-GHJK',
          verificationUri: 'https://app.example.com/device', expiresAt: Date.now() + 1000, interval: 5, nextPollAt: Date.now() })
      `
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: cliRoot, encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), APPDATA: home },
      })
      expect(result.status).toBe(0)
      const files = filesUnder(home).filter((f) => /config\.json$|device-login\.json$/.test(f))
      expect(files.length).toBe(2)
      for (const file of files) expect(statSync(file).mode & 0o777).toBe(0o600)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

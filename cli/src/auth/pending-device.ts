import Conf from 'conf'
import { closeSync, openSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** A not-yet-approved device grant. `deviceCode` is bearer-equivalent: keep it out of output and the repo. */
export interface PendingDevice {
  apiUrl: string
  clientId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: number
  interval: number
  nextPollAt: number
}

export interface PendingStore {
  load(): PendingDevice | null
  save(pending: PendingDevice): void
  clear(): void
  withLock<T>(fn: () => Promise<T>): Promise<T>
}

const LOCK_STALE_MS = 30_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Stored outside the repository in the user's config directory with 0600 permissions.
 * Conf writes atomically (temp file + rename). A lock file serialises concurrent logins.
 */
export function createPendingStore(options: { cwd?: string } = {}): PendingStore {
  const conf = new Conf<{ pending?: PendingDevice }>({
    projectName: 'supercheck-cli',
    configName: 'device-login',
    configFileMode: 0o600,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  })
  const lockPath = join(dirname(conf.path), 'device-login.lock')

  async function acquire(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        closeSync(openSync(lockPath, 'wx', 0o600))
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true })
        } catch { /* lock vanished: retry */ }
        await sleep(50)
      }
    }
    throw new Error('Another `supercheck login` is in progress. Try again in a moment.')
  }

  return {
    load() {
      const pending = conf.get('pending')
      return pending && typeof pending.deviceCode === 'string' ? pending : null
    },
    save(pending) { conf.set('pending', pending) },
    clear() { conf.delete('pending') },
    async withLock(fn) {
      await acquire()
      try { return await fn() } finally { rmSync(lockPath, { force: true }) }
    },
  }
}

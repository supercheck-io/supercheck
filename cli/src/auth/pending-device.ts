import Conf from 'conf'
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { CLIError, ExitCode } from '../utils/errors.js'
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

// Must exceed the longest hold (code request + poll + verification, each with its own timeout).
const LOCK_STALE_MS = 180_000
const LOCK_WAIT_ATTEMPTS = 200
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

  /** Returns an ownership token; release only removes the lock if it is still ours. */
  async function acquire(): Promise<string> {
    const owner = randomBytes(8).toString('hex')
    for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
      try {
        writeFileSync(lockPath, owner, { flag: 'wx', mode: 0o600 })
        return owner
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) rmSync(lockPath, { force: true })
        } catch { /* lock vanished: retry */ }
        await sleep(50)
      }
    }
    throw new CLIError('Another `supercheck login` is in progress. Wait a moment and try again.', ExitCode.GeneralError)
  }

  function release(owner: string): void {
    try {
      if (readFileSync(lockPath, 'utf8') === owner) rmSync(lockPath, { force: true })
    } catch { /* already gone */ }
  }

  return {
    load() {
      const pending = conf.get('pending')
      return pending && typeof pending.deviceCode === 'string' ? pending : null
    },
    save(pending) { conf.set('pending', pending) },
    clear() { conf.delete('pending') },
    async withLock(fn) {
      const owner = await acquire()
      try { return await fn() } finally { release(owner) }
    },
  }
}

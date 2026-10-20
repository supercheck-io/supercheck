import { CLIError, ExitCode } from '../utils/errors.js'
import { DEVICE_CLIENT_ID, type DeviceCodeResponse, type DeviceTokenContext, type TokenPollResult } from './device-flow.js'
import type { PendingDevice, PendingStore } from './pending-device.js'

/** Terminal device-login failures. The `CODE:` prefix is what the JSON error handler surfaces as `code`. */
export class DeviceLoginError extends CLIError {
  constructor(public readonly code: string, message: string, exitCode: ExitCode = ExitCode.AuthError) {
    super(`${code}: ${message}`, exitCode)
    this.name = 'DeviceLoginError'
  }
}

export type LoginOutcome =
  | { state: 'authenticated'; apiUrl: string; context: DeviceTokenContext; verified: boolean; expiresInSeconds?: number }
  | {
      state: 'authorization_pending'
      apiUrl: string
      verificationUri: string
      verificationUriComplete?: string
      userCode: string
      retryAfterSeconds: number
      expiresAt: string
    }

export interface LoginDeps {
  now(): number
  store: PendingStore
  requestCode(apiUrl: string): Promise<DeviceCodeResponse>
  pollToken(apiUrl: string, deviceCode: string): Promise<TokenPollResult>
  /** Verify the new key against the API, then persist it. Must not erase prior credentials on failure. */
  finalize(apiUrl: string, token: string): Promise<{ verified: boolean }>
}

const SLOW_DOWN_STEP_SECONDS = 5

function pendingOutcome(apiUrl: string, pending: PendingDevice, now: number): LoginOutcome {
  return {
    state: 'authorization_pending',
    apiUrl,
    verificationUri: pending.verificationUri,
    verificationUriComplete: pending.verificationUriComplete,
    userCode: pending.userCode,
    retryAfterSeconds: Math.max(0, Math.ceil((pending.nextPollAt - now) / 1000)),
    expiresAt: new Date(pending.expiresAt).toISOString(),
  }
}

/**
 * One non-blocking step of device login. Safe to call repeatedly (and from agents):
 * it creates or resumes exactly one grant per API origin, polls at most once, and
 * never makes a network request before the server-mandated next poll time.
 */
export async function loginStep(apiUrl: string, deps: LoginDeps): Promise<LoginOutcome> {
  return deps.store.withLock(async () => {
    const now = deps.now()
    let pending = deps.store.load()
    if (pending && (pending.apiUrl !== apiUrl || pending.clientId !== DEVICE_CLIENT_ID || pending.expiresAt <= now)) {
      deps.store.clear()
      pending = null
    }

    if (!pending) {
      const grant = await deps.requestCode(apiUrl)
      pending = {
        apiUrl,
        clientId: DEVICE_CLIENT_ID,
        deviceCode: grant.deviceCode,
        userCode: grant.userCode,
        verificationUri: grant.verificationUri,
        verificationUriComplete: grant.verificationUriComplete,
        expiresAt: now + grant.expiresIn * 1000,
        interval: grant.interval,
        nextPollAt: now + grant.interval * 1000,
      }
      deps.store.save(pending)
      return pendingOutcome(apiUrl, pending, now)
    }

    if (now < pending.nextPollAt) return pendingOutcome(apiUrl, pending, now)

    // A poll that may have committed server-side is never retried automatically: persist the
    // next poll time first so a crash or lost response cannot cause a hot retry loop.
    const polledAt = now
    deps.store.save({ ...pending, nextPollAt: polledAt + pending.interval * 1000 })
    const result = await deps.pollToken(apiUrl, pending.deviceCode)

    switch (result.kind) {
      case 'pending': {
        const interval = result.interval ?? pending.interval
        const next = { ...pending, interval, nextPollAt: polledAt + interval * 1000 }
        deps.store.save(next)
        return pendingOutcome(apiUrl, next, polledAt)
      }
      case 'slow_down': {
        const interval = Math.max(result.interval ?? 0, pending.interval + SLOW_DOWN_STEP_SECONDS)
        const next = { ...pending, interval, nextPollAt: polledAt + interval * 1000 }
        deps.store.save(next)
        return pendingOutcome(apiUrl, next, polledAt)
      }
      case 'success': {
        // The grant is consumed server-side. Clear the pending secret regardless of what happens next.
        deps.store.clear()
        const { verified } = await deps.finalize(apiUrl, result.accessToken)
        return {
          state: 'authenticated',
          apiUrl,
          context: result.context,
          verified,
          expiresInSeconds: result.expiresIn || undefined,
        }
      }
      case 'denied':
        deps.store.clear()
        throw new DeviceLoginError('DEVICE_CODE_DENIED', 'The login request was denied in the browser. Run `supercheck login` to try again.')
      case 'expired':
        deps.store.clear()
        throw new DeviceLoginError('DEVICE_CODE_EXPIRED', 'The login code expired before it was approved. Run `supercheck login` for a new one.')
      case 'consumed':
        deps.store.clear()
        throw new DeviceLoginError(
          'DEVICE_CODE_CONSUMED',
          'This login code is unknown or was already used. If you approved it but this machine never received the credential (for example a dropped connection), run `supercheck login --reauth` and revoke the unused key under CLI tokens in the dashboard.',
        )
      case 'token_limit':
        // Grant stays approved: the user can free a slot and simply re-run login.
        deps.store.save({ ...pending, nextPollAt: polledAt + pending.interval * 1000 })
        throw new DeviceLoginError(
          'TOKEN_LIMIT_REACHED',
          'This project already has the maximum number of CLI tokens. Revoke one under Organization Admin → CLI Tokens, then run `supercheck login` again before the code expires.',
        )
      case 'disabled':
        deps.store.clear()
        throw new DeviceLoginError('AUTH_REQUIRED', 'Browser login is not enabled on this server. Use `supercheck login --token <token>`.')
    }
  })
}

/** Blocking variant for interactive terminals: repeats steps until approved, denied, or expired. */
export async function loginWait(
  apiUrl: string,
  deps: LoginDeps,
  hooks: { sleep(ms: number): Promise<void>; onPending?(outcome: Extract<LoginOutcome, { state: 'authorization_pending' }>): void; deadline?: number },
): Promise<Extract<LoginOutcome, { state: 'authenticated' }>> {
  let announced = false
  let grantExpiresAt = Infinity
  for (;;) {
    // Never silently start a second grant: the person only saw the first code.
    if (deps.now() >= grantExpiresAt) {
      deps.store.clear()
      throw new DeviceLoginError('DEVICE_CODE_EXPIRED', 'The login code expired before it was approved. Run `supercheck login` for a new one.')
    }
    const outcome = await loginStep(apiUrl, deps)
    if (outcome.state === 'authenticated') return outcome
    if (!announced) {
      announced = true
      grantExpiresAt = Date.parse(outcome.expiresAt)
      hooks.onPending?.(outcome)
    }
    if (hooks.deadline !== undefined && deps.now() >= hooks.deadline) {
      throw new CLIError('Timed out waiting for browser approval. Run `supercheck login` again to resume.', ExitCode.Timeout)
    }
    await hooks.sleep(Math.max(1, outcome.retryAfterSeconds) * 1000)
  }
}

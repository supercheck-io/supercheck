import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { loginStep, loginWait, DeviceLoginError, type LoginDeps } from '../device-login.js'
import type { PendingDevice, PendingStore } from '../pending-device.js'
import type { TokenPollResult } from '../device-flow.js'

const API = 'https://app.example.com'
const T0 = 1_700_000_000_000

function memoryStore(): PendingStore & { value: PendingDevice | null } {
  const store = {
    value: null as PendingDevice | null,
    load: () => store.value,
    save: (p: PendingDevice) => { store.value = p },
    clear: () => { store.value = null },
    withLock: <T,>(fn: () => Promise<T>) => fn(),
  }
  return store
}

let clock = T0
let store: ReturnType<typeof memoryStore>
let requestCode: jest.Mock<LoginDeps['requestCode']>
let pollToken: jest.Mock<LoginDeps['pollToken']>
let finalize: jest.Mock<LoginDeps['finalize']>
let deps: LoginDeps

beforeEach(() => {
  clock = T0
  store = memoryStore()
  requestCode = jest.fn<LoginDeps['requestCode']>(async () => ({
    deviceCode: 'dev'.repeat(10), userCode: 'BCDF-GHJK', verificationUri: `${API}/device`,
    verificationUriComplete: `${API}/device?code=BCDF-GHJK`, expiresIn: 900, interval: 5,
  }))
  pollToken = jest.fn<LoginDeps['pollToken']>(async () => ({ kind: 'pending' }) as TokenPollResult)
  finalize = jest.fn<LoginDeps['finalize']>(async () => ({ verified: true }))
  deps = { now: () => clock, store, requestCode, pollToken, finalize }
})

describe('loginStep', () => {
  it('creates one grant and returns pending without polling', async () => {
    const out = await loginStep(API, deps)
    expect(out).toMatchObject({ state: 'authorization_pending', userCode: 'BCDF-GHJK', retryAfterSeconds: 5 })
    expect(requestCode).toHaveBeenCalledTimes(1)
    expect(pollToken).not.toHaveBeenCalled()
    expect(store.value?.deviceCode).toBeTruthy()
  })

  it('does not touch the network before the next permitted poll', async () => {
    await loginStep(API, deps)
    clock += 2000
    const out = await loginStep(API, deps)
    expect(out).toMatchObject({ state: 'authorization_pending', retryAfterSeconds: 3 })
    expect(requestCode).toHaveBeenCalledTimes(1)
    expect(pollToken).not.toHaveBeenCalled()
  })

  it('polls once when due and stays pending', async () => {
    await loginStep(API, deps)
    clock += 5000
    const out = await loginStep(API, deps)
    expect(pollToken).toHaveBeenCalledTimes(1)
    expect(out.state).toBe('authorization_pending')
  })

  it('honours slow_down by lengthening the interval', async () => {
    await loginStep(API, deps)
    clock += 5000
    pollToken.mockResolvedValueOnce({ kind: 'slow_down', interval: 10 })
    const out = await loginStep(API, deps)
    expect(out).toMatchObject({ retryAfterSeconds: 10 })
    expect(store.value?.interval).toBe(10)
  })

  it('persists the next poll time before polling so a crash cannot hot-loop', async () => {
    await loginStep(API, deps)
    clock += 5000
    let seenDuringPoll: number | undefined
    pollToken.mockImplementationOnce(async () => {
      seenDuringPoll = store.value?.nextPollAt
      throw new Error('network dropped')
    })
    await expect(loginStep(API, deps)).rejects.toThrow('network dropped')
    expect(seenDuringPoll).toBe(clock + 5000)
    expect(store.value?.nextPollAt).toBe(clock + 5000)
  })

  it('finalizes on success, clears the secret and never repeats the exchange', async () => {
    await loginStep(API, deps)
    clock += 5000
    pollToken.mockResolvedValueOnce({
      kind: 'success', accessToken: 'sck_live_' + 'a'.repeat(32), expiresIn: 90 * 86400,
      context: { project: { id: 'p', name: 'Proj' }, organization: { id: 'o', name: 'Org' } },
    })
    const out = await loginStep(API, deps)
    expect(out).toMatchObject({ state: 'authenticated', verified: true, expiresInSeconds: 90 * 86400 })
    expect(finalize).toHaveBeenCalledWith(API, 'sck_live_' + 'a'.repeat(32))
    expect(store.value).toBeNull()
  })

  it.each([
    ['denied', 'DEVICE_CODE_DENIED'],
    ['expired', 'DEVICE_CODE_EXPIRED'],
    ['consumed', 'DEVICE_CODE_CONSUMED'],
    ['disabled', 'AUTH_REQUIRED'],
  ] as const)('maps %s to %s and clears pending state', async (kind, code) => {
    await loginStep(API, deps)
    clock += 5000
    pollToken.mockResolvedValueOnce({ kind } as TokenPollResult)
    const error = await loginStep(API, deps).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeviceLoginError)
    expect((error as DeviceLoginError).code).toBe(code)
    expect((error as DeviceLoginError).exitCode).toBe(2)
    expect((error as Error).message.startsWith(`${code}:`)).toBe(true)
    expect(store.value).toBeNull()
  })

  it('keeps the approved grant when the project token limit blocks issuance', async () => {
    await loginStep(API, deps)
    clock += 5000
    pollToken.mockResolvedValueOnce({ kind: 'token_limit' })
    await expect(loginStep(API, deps)).rejects.toMatchObject({ code: 'TOKEN_LIMIT_REACHED' })
    expect(store.value).not.toBeNull()
  })

  it('replaces expired grants and grants for another origin', async () => {
    await loginStep(API, deps)
    clock += 901_000
    await loginStep(API, deps)
    expect(requestCode).toHaveBeenCalledTimes(2)
    await loginStep('https://other.example.com', deps)
    expect(requestCode).toHaveBeenCalledTimes(3)
    expect(store.value?.apiUrl).toBe('https://other.example.com')
  })
})

describe('loginWait', () => {
  it('polls until approved', async () => {
    let polls = 0
    pollToken.mockImplementation(async () => {
      polls++
      return polls < 3
        ? { kind: 'pending' }
        : { kind: 'success', accessToken: 'sck_live_' + 'b'.repeat(32), expiresIn: 100, context: {} }
    })
    const onPending = jest.fn()
    const out = await loginWait(API, deps, {
      sleep: async (ms) => { clock += ms },
      onPending,
    })
    expect(out.state).toBe('authenticated')
    expect(onPending).toHaveBeenCalledTimes(1)
    expect(polls).toBe(3)
  })

  it('stops with a timeout error at the caller deadline but keeps the grant to resume', async () => {
    await expect(
      loginWait(API, deps, { sleep: async (ms) => { clock += ms }, deadline: T0 + 20_000 }),
    ).rejects.toMatchObject({ exitCode: 5 })
    expect(store.value).not.toBeNull()
  })

  it('reports expiry when the code lapses', async () => {
    await expect(
      loginWait(API, deps, { sleep: async (ms) => { clock += ms * 200 } }),
    ).rejects.toMatchObject({ code: 'DEVICE_CODE_EXPIRED' })
    expect(store.value).toBeNull()
  })
})

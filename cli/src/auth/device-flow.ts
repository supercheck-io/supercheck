import { hostname } from 'node:os'
import { ApiRequestError, CLIError, ExitCode, networkErrorMessage } from '../utils/errors.js'
import { getProxyAgent, getProxyEnv } from '../utils/proxy.js'
import { CLI_VERSION } from '../version.js'

export const DEVICE_CLIENT_ID = 'supercheck-cli'
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REQUEST_TIMEOUT_MS = 15_000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface DeviceCodeResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  interval: number
}

export interface DeviceTokenContext {
  user?: { id?: string; name?: string | null; email?: string }
  organization?: { id?: string; name?: string; slug?: string | null }
  project?: { id?: string; name?: string; slug?: string | null }
}

export type TokenPollResult =
  | { kind: 'success'; accessToken: string; expiresIn: number; context: DeviceTokenContext }
  | { kind: 'pending'; interval?: number }
  | { kind: 'slow_down'; interval?: number }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'consumed' }
  | { kind: 'token_limit' }
  | { kind: 'disabled' }

export type FetchLike = (url: URL, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>

/** HTTPS only; plain HTTP is accepted solely for loopback development servers. No embedded credentials. */
export function assertSafeApiUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new CLIError('Invalid API URL. Expected an http:// or https:// URL.', ExitCode.ConfigError) }
  if (url.username || url.password) throw new CLIError('Invalid API URL. Use HTTP(S) without embedded credentials.', ExitCode.ConfigError)
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure) throw new CLIError('Browser login requires an https:// API URL (http:// is allowed only for localhost).', ExitCode.ConfigError)
  return url
}

async function postForm(
  apiUrl: string,
  path: string,
  form: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = assertSafeApiUrl(apiUrl)
  const url = new URL(path, base.origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const proxy = getProxyEnv(url)
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      // Never follow a redirect: it could carry the device secret to another origin.
      redirect: 'error',
      signal: controller.signal,
      ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
    })
    const text = await response.text()
    let body: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    } catch { /* non-JSON body: handled by status */ }
    return { status: response.status, body }
  } catch (error) {
    if (error instanceof CLIError) throw error
    throw new ApiRequestError(`Could not reach ${base.origin}: ${networkErrorMessage(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback

function sameOriginUrl(raw: unknown, api: URL): string | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const url = new URL(raw)
    return url.origin === api.origin && !url.username && !url.password ? url.toString() : undefined
  } catch { return undefined }
}

export async function requestDeviceCode(apiUrl: string, fetchImpl: FetchLike = fetch as FetchLike): Promise<DeviceCodeResponse> {
  const api = assertSafeApiUrl(apiUrl)
  const { status, body } = await postForm(apiUrl, '/api/auth/device/code', {
    client_id: DEVICE_CLIENT_ID,
    client_name: 'supercheck-cli',
    cli_version: CLI_VERSION,
    hostname: hostname().slice(0, 64),
  }, fetchImpl)

  if (status === 503 && body.error === 'device_auth_disabled') {
    throw new CLIError('AUTH_REQUIRED: Browser login is not enabled on this server. Create a token in the dashboard and run `supercheck login --token <token>`.', ExitCode.AuthError)
  }
  if (status === 404) {
    throw new CLIError('AUTH_REQUIRED: This server does not support browser login. Create a token in the dashboard and run `supercheck login --token <token>`.', ExitCode.AuthError)
  }
  if (status === 429) throw new ApiRequestError('Too many login attempts. Wait a minute and try again.', 429)
  if (status !== 200) throw new ApiRequestError(`Device login request failed (${status})`, status)

  const deviceCode = body.device_code
  const userCode = body.user_code
  const verificationUri = sameOriginUrl(body.verification_uri, api)
  if (
    typeof deviceCode !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(deviceCode) ||
    typeof userCode !== 'string' || !/^[A-Za-z0-9-]{4,20}$/.test(userCode) ||
    !verificationUri
  ) {
    throw new ApiRequestError('Device login response was malformed or pointed at a different host.', status)
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: sameOriginUrl(body.verification_uri_complete, api),
    expiresIn: clamp(body.expires_in, 60, 3600, 900),
    interval: clamp(body.interval, 1, 60, 5),
  }
}

export async function pollDeviceToken(apiUrl: string, deviceCode: string, fetchImpl: FetchLike = fetch as FetchLike): Promise<TokenPollResult> {
  const { status, body } = await postForm(apiUrl, '/api/auth/device/token', {
    grant_type: GRANT_TYPE,
    client_id: DEVICE_CLIENT_ID,
    device_code: deviceCode,
  }, fetchImpl)

  if (status === 200) {
    const token = body.access_token
    if (typeof token !== 'string' || !/^sck_(?:live|test)_[A-Za-z0-9]{16,200}$/.test(token) || body.token_type !== 'Bearer') {
      throw new ApiRequestError('Device login returned an unusable credential.', status)
    }
    return {
      kind: 'success',
      accessToken: token,
      expiresIn: clamp(body.expires_in, 0, 366 * 24 * 3600, 0),
      context: (body.context && typeof body.context === 'object' ? body.context : {}) as DeviceTokenContext,
    }
  }

  const interval = typeof body.interval === 'number' ? clamp(body.interval, 1, 120, 5) : undefined
  switch (body.error) {
    case 'authorization_pending': return { kind: 'pending', interval }
    case 'slow_down': return { kind: 'slow_down', interval: interval ?? 10 }
    case 'access_denied': return { kind: 'denied' }
    case 'expired_token': return { kind: 'expired' }
    case 'invalid_grant': return { kind: 'consumed' }
    case 'token_limit_reached': return { kind: 'token_limit' }
    case 'device_auth_disabled': return { kind: 'disabled' }
    default:
      if (status === 429) return { kind: 'slow_down', interval: interval ?? 30 }
      throw new ApiRequestError(`Device login failed (${status}${typeof body.error === 'string' ? `: ${body.error.slice(0, 40)}` : ''})`, status)
  }
}

import { ApiRequestError, CLIError, ExitCode } from './errors.js'

export interface ErrorClassification {
  code: string
  retryable: boolean
  nextActions: { command: string; why: string }[]
}

const BODY_CODE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/
const bodyCode = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' && BODY_CODE.test(code) ? code : undefined
}

const SUBSCRIPTION_REASONS = new Set(['subscription_required', 'polar_customer_missing', 'polar_customer_invalid'])

/**
 * Additive, stable error codes for agents. Server-provided reasons are preserved (they stay in `details`);
 * nothing is inferred from a bare 402/403, so a permission failure is never reported as a billing one.
 */
export function classifyError(error: unknown, hasCredentials = true): ErrorClassification | undefined {
  // A CLIError that wraps an API answer (`details.status`) is classified exactly like the API error itself.
  if (error instanceof CLIError && !(error instanceof ApiRequestError)) {
    const status = (error.details as { status?: unknown } | undefined)?.status
    if (typeof status === 'number') return classifyError(new ApiRequestError(error.message, status), hasCredentials)
  }
  if (error instanceof ApiRequestError) {
    const status = error.statusCode ?? 0
    const code = bodyCode(error.responseBody)
    if (status === 401) {
      return hasCredentials
        ? { code: 'TOKEN_INVALID', retryable: false, nextActions: process.env.SUPERCHECK_TOKEN
          ? [{ command: 'export SUPERCHECK_TOKEN=<new CLI token>', why: 'SUPERCHECK_TOKEN is set and was rejected; browser login cannot override it. Replace or unset it' }]
          : [{ command: 'supercheck login --reauth', why: 'Replace the rejected or expired credential' }] }
        : { code: 'AUTH_REQUIRED', retryable: false, nextActions: [{ command: 'supercheck login --json', why: 'Authenticate in the browser' }] }
    }
    if (status === 402) {
      if (code === 'BILLING_BLOCKED') return { code: 'SPENDING_LIMIT_REACHED', retryable: false, nextActions: [{ command: 'supercheck plan --json', why: 'Inspect plan status; a person must raise the spending limit in the dashboard' }] }
      if (code && SUBSCRIPTION_REASONS.has(code)) return { code: 'SUBSCRIPTION_REQUIRED', retryable: false, nextActions: [{ command: 'supercheck plan --json', why: 'Inspect plan status; a person must choose a plan in the dashboard' }] }
      return { code: 'PAYMENT_REQUIRED', retryable: false, nextActions: [{ command: 'supercheck plan --json', why: 'Inspect plan status' }] }
    }
    if (status === 403) return { code: 'PERMISSION_DENIED', retryable: false, nextActions: [{ command: 'supercheck whoami --json', why: 'Check the role and project of the current credential' }] }
    if (status === 409) return { code: 'CONFLICT', retryable: false, nextActions: [] }
    if (status === 429) return { code: 'RATE_LIMITED', retryable: true, nextActions: [] }
    if (status === 400 || status === 422) return { code: 'VALIDATION_FAILED', retryable: false, nextActions: [] }
    if (status === 0 || status >= 500) return { code: 'SERVICE_UNAVAILABLE', retryable: true, nextActions: [] }
  }
  if (error instanceof CLIError && !(error instanceof ApiRequestError) && error.exitCode === ExitCode.AuthError && !hasCredentials && /^Not authenticated\b/.test(error.message)) {
    return { code: 'AUTH_REQUIRED', retryable: false, nextActions: [{ command: 'supercheck login --json', why: 'Authenticate in the browser' }] }
  }
  if (error instanceof CLIError && error.exitCode === ExitCode.ConfigError && /CONFIRMATION_REQUIRED/.test(error.message)) {
    return { code: 'CONFIRMATION_REQUIRED', retryable: false, nextActions: [] }
  }
  return undefined
}

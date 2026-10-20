import { spawn } from 'node:child_process'
import { getApiClient } from '../api/client.js'
import { getStoredBaseUrl, getToken, setCredentials } from '../auth/store.js'
import { apiBase, pollDeviceToken, requestDeviceCode } from '../auth/device-flow.js'
import { DeviceLoginError, loginStep, loginWait, type LoginDeps, type LoginOutcome } from '../auth/device-login.js'
import { createPendingStore } from '../auth/pending-device.js'
import { getOutputFormat } from '../output/formatter.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { createSpinner } from '../utils/spinner.js'

const DEFAULT_API_URL = 'https://app.supercheck.io'
const SCHEMA_VERSION = '1.0'

export interface DeviceLoginOptions {
  url?: string
  reauth?: boolean
  /** Commander sets this to false for --no-browser. */
  browser?: boolean
  wait?: boolean
  timeout?: string
}

/** Opens the system browser without a shell. Best effort: the printed URL and code always work. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => { /* no browser available: the user opens the printed URL */ })
    child.unref()
  } catch { /* ignore */ }
}

function defaultDeps(): LoginDeps {
  return {
    now: () => Date.now(),
    store: createPendingStore(),
    requestCode: (apiUrl) => requestDeviceCode(apiUrl),
    pollToken: (apiUrl, deviceCode) => pollDeviceToken(apiUrl, deviceCode),
    async finalize(apiUrl, token) {
      let verified = false
      try {
        await getApiClient({ baseUrl: apiUrl, token }).get('/api/context')
        verified = true
      } catch (error) {
        if (error instanceof ApiRequestError && [401, 403].includes(error.statusCode ?? 0)) {
          throw new DeviceLoginError('DEVICE_LOGIN_UNVERIFIED', 'The server issued a credential that it then rejected. Nothing was saved; run `supercheck login --reauth`.')
        }
        // Transient network trouble: the key came straight from the authenticated exchange, so keep it.
      }
      setCredentials(token, apiUrl)
      return { verified }
    },
  }
}

function printable(outcome: LoginOutcome): Record<string, unknown> {
  if (outcome.state === 'authenticated') {
    return {
      schemaVersion: SCHEMA_VERSION,
      state: 'authenticated',
      authenticated: true,
      apiUrl: outcome.apiUrl,
      user: outcome.context.user ? { id: outcome.context.user.id, name: outcome.context.user.name, email: outcome.context.user.email } : undefined,
      organization: outcome.context.organization,
      project: outcome.context.project,
      expiresInDays: outcome.expiresInSeconds ? Math.round(outcome.expiresInSeconds / 86400) : undefined,
      verified: outcome.verified,
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    state: 'authorization_pending',
    authenticated: false,
    apiUrl: outcome.apiUrl,
    // Base URL + user code only: the complete URL embeds the code and would be masked by redaction.
    next: {
      action: 'authorize',
      url: outcome.verificationUri,
      userCode: outcome.userCode,
      retryAfterSeconds: outcome.retryAfterSeconds,
      expiresAt: outcome.expiresAt,
      command: 'supercheck login --json',
    },
  }
}

function printInstructions(outcome: Extract<LoginOutcome, { state: 'authorization_pending' }>): void {
  logger.newline()
  logger.info('To finish signing in, open this page in your browser:')
  logger.info(`  ${outcome.verificationUri}`)
  logger.info(`and confirm the code:  ${outcome.userCode}`)
  logger.info('Only approve if you just ran this command yourself.')
  logger.newline()
}

function reportAuthenticated(outcome: Extract<LoginOutcome, { state: 'authenticated' }>): void {
  logger.success('Authentication successful')
  const project = outcome.context.project?.name
  const org = outcome.context.organization?.name
  if (project) logger.info(`  Project: ${project}${org ? ` (${org})` : ''}`)
  if (outcome.expiresInSeconds) logger.info(`  Key expires in ${Math.round(outcome.expiresInSeconds / 86400)} days`)
  logger.info(`  API URL: ${outcome.apiUrl}`)
  if (!outcome.verified) logger.warn('Could not reach the server to verify the new key; run `supercheck whoami` to confirm.')
}

export async function runDeviceLogin(options: DeviceLoginOptions, depsOverride?: LoginDeps): Promise<void> {
  const json = getOutputFormat() === 'json'
  const requestedUrl = options.url ?? getStoredBaseUrl() ?? DEFAULT_API_URL
  const apiUrl = apiBase(requestedUrl)
  const envToken = Boolean(process.env.SUPERCHECK_TOKEN?.trim())

  // Existing, working credentials win unless the user explicitly re-authenticates. The stored
  // key is only ever sent to the host it was issued for, never to an arbitrary --url.
  const existing = getToken()
  const knownBase = getStoredBaseUrl() ?? DEFAULT_API_URL
  const sameHost = (() => {
    try { return new URL(knownBase).origin === new URL(apiUrl).origin } catch { return false }
  })()
  if (existing && !options.reauth && sameHost) {
    try {
      const { data } = await getApiClient({ baseUrl: apiUrl, token: existing }).get<{
        organization?: { id: string; name: string | null; slug: string | null }
        project?: { id: string; name: string; slug: string | null }
        user?: { id: string }
      }>('/api/context')
      const outcome: LoginOutcome = {
        state: 'authenticated', apiUrl, verified: true,
        context: { user: data.user, organization: data.organization as never, project: data.project as never },
      }
      if (json) logger.output(JSON.stringify(printable(outcome)))
      reportAuthenticated(outcome)
      logger.info('Already signed in. Use `supercheck login --reauth` to switch accounts or projects.')
      return
    } catch (error) {
      if (!(error instanceof ApiRequestError && [401, 403].includes(error.statusCode ?? 0))) throw error
      // Stored credential is no longer valid: fall through to a fresh browser login.
    }
  }
  if (envToken) {
    // A new browser login would be stored but never used: SUPERCHECK_TOKEN always wins.
    throw new CLIError(
      'AUTH_REQUIRED: SUPERCHECK_TOKEN is set and takes precedence over any stored login, so a new browser login would never be used (the token was rejected, was issued for a different server, or --reauth was requested). Unset it or replace it with a valid CLI token, then run `supercheck login` again.',
      ExitCode.AuthError,
    )
  }

  const deps = depsOverride ?? defaultDeps()
  const interactive = options.wait === true ||
    (!json && Boolean(process.stdin.isTTY && process.stderr.isTTY) && !process.env.CI)

  if (!interactive) {
    const outcome = await loginStep(apiUrl, deps)
    if (json) {
      logger.output(JSON.stringify(printable(outcome)))
      return
    }
    if (outcome.state === 'authenticated') reportAuthenticated(outcome)
    else {
      printInstructions(outcome)
      logger.info('Run `supercheck login` again after approving to finish (or use --wait).')
      // Not signed in yet: scripts such as `supercheck login && supercheck deploy` must not continue.
      throw new CLIError('AUTHORIZATION_PENDING: Approve the login in your browser, then run `supercheck login` again.', ExitCode.AuthError)
    }
    return
  }

  const timeoutSeconds = Number.parseInt(options.timeout ?? '900', 10)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 3600) {
    throw new CLIError('--timeout must be between 30 and 3600 seconds.', ExitCode.ConfigError)
  }
  const spinner = createSpinner('Waiting for browser approval…')
  try {
    const outcome = await loginWait(apiUrl, deps, {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      deadline: Date.now() + timeoutSeconds * 1000,
      onPending(pending) {
        // Agents need the URL and code before the call blocks: emit the pending object as the first JSON line.
        if (json) logger.output(JSON.stringify(printable(pending)))
        printInstructions(pending)
        if (options.browser !== false && !json && !process.env.CI) {
          openBrowser(pending.verificationUriComplete ?? pending.verificationUri)
          logger.info('Opening your browser… (use --no-browser to disable)')
        }
        spinner.start()
      },
    })
    spinner.stop()
    if (json) logger.output(JSON.stringify(printable(outcome)))
    reportAuthenticated(outcome)
  } finally {
    spinner.stop()
  }
}

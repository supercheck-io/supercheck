import { Command } from 'commander'
import {
  setToken,
  setBaseUrl,
  clearAuth,
  getToken,
  getStoredBaseUrl,
  validateTokenFormat,
} from '../auth/store.js'
import { getApiClient } from '../api/client.js'
import { logger } from '../utils/logger.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { safeTokenPreview } from '../utils/resources.js'
import { withSpinner } from '../utils/spinner.js'
import { getOutputFormat } from '../output/formatter.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'

export const loginCommand = new Command('login')
  .description('Authenticate with Supercheck')
  .option('--token <token>', 'Provide a CLI token directly (for CI/CD)')
  .option('--url <url>', 'Supercheck API URL (for self-hosted instances)')
  .action(async (options: { token?: string; url?: string }) => {
    if (options.token) {
      const token = options.token.trim()
      if (!validateTokenFormat(token)) {
        throw new CLIError(
          'Invalid token. `supercheck login` requires a CLI token (sck_live_* or sck_test_*). Trigger keys (sck_trigger_* / job_*) are only for `supercheck job trigger` via SUPERCHECK_TRIGGER_KEY.',
          ExitCode.AuthError,
        )
      }

      // Build client with provided options (don't persist until verified)
      const client = getApiClient({
        baseUrl: options.url,
        token,
      })

      try {
        // Verify token using a Bearer-auth-compatible endpoint
        await withSpinner(
          'Verifying token...',
          () => client.get('/api/cli-tokens'),
          { successText: 'Token verified' },
        )
      } catch {
        throw new CLIError(
          'Token verification failed. Please check your token and try again.',
          ExitCode.AuthError,
        )
      }

      // Token verified — now persist credentials
      setToken(token)
      if (options.url) {
        setBaseUrl(options.url)
      }

      const tokenPreview = safeTokenPreview(token)
      logger.success('Authentication successful')
      logger.info(`  Token: ${tokenPreview}`)
      if (options.url) {
        logger.info(`  API URL: ${options.url}`)
      }
      return
    }

    // Interactive login — not yet implemented
    logger.newline()
    logger.info('To authenticate, create a CLI token in the Dashboard:')
    logger.info('  Dashboard → Project Settings → CLI Tokens → Create Token')
    logger.newline()
    if (options.url) {
      logger.info(`Then run: supercheck login --token <your-token> --url ${options.url}`)
    } else {
      logger.info('Then run: supercheck login --token <your-token>')
    }
    logger.newline()
    logger.warn('Browser-based OAuth login is not yet implemented.')
  })

export const logoutCommand = new Command('logout')
  .description('Remove stored authentication credentials')
  .action(() => {
    clearAuth()
    logger.success('Logged out successfully. Stored credentials removed.')
  })

export const whoamiCommand = new Command('whoami')
  .description('Show current authentication context')
  .action(async () => {
    const token = getToken()
    if (!token) {
      throw new CLIError(
        'Not authenticated. Run `supercheck login` to authenticate.',
        ExitCode.AuthError,
      )
    }

    const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl()
    const client = getApiClient({ token, baseUrl: baseUrl ?? undefined })

    try {
      // Use cli-tokens endpoint which supports Bearer auth via requireAuthContext()
      const data = await withSpinner(
        'Fetching context...',
        async () => {
          const { data } = await client.get<{
            success: boolean
            tokens: Array<{
              id: string
              name: string
              start: string
              enabled: boolean
              createdByName: string
              expiresAt: string | null
              lastRequest: string | null
            }>
          }>('/api/cli-tokens')
          return data
        },
        { successText: 'Context loaded' },
      )

      const tokenPreview = safeTokenPreview(token)

      // Match the current token against the server's token list by prefix
      const activeToken = data.tokens?.find((t) => t.start && token.startsWith(t.start.replace(/\.+$/, '')))

      // JSON output mode
      if (getOutputFormat() === 'json') {
        const jsonData: Record<string, unknown> = {
          user: activeToken?.createdByName ?? null,
          tokenName: activeToken?.name ?? null,
          tokenPreview,
          apiUrl: baseUrl ?? 'https://app.supercheck.io',
          expiresAt: activeToken?.expiresAt ?? null,
          lastUsed: activeToken?.lastRequest ?? null,
        }
        logger.output(JSON.stringify(jsonData, null, 2))
        return
      }

      logger.newline()
      logger.header('Current Context')
      logger.newline()
      if (activeToken?.createdByName && activeToken.createdByName !== '-') {
        logger.info(`  User:    ${activeToken.createdByName}`)
      }
      if (activeToken?.name) {
        logger.info(`  Token:   ${activeToken.name} (${tokenPreview})`)
      } else {
        logger.info(`  Token:   ${tokenPreview}`)
      }
      logger.info(`  API URL: ${baseUrl ?? 'https://app.supercheck.io'}`)
      if (activeToken?.expiresAt) {
        logger.info(`  Expires: ${activeToken.expiresAt}`)
      }
      if (activeToken?.lastRequest) {
        logger.info(`  Last used: ${activeToken.lastRequest}`)
      }
      logger.newline()
    } catch {
      throw new CLIError(
        'Failed to verify authentication. Your token may be expired or invalid.',
        ExitCode.AuthError,
      )
    }
  })

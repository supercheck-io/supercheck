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
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
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

      const baseUrl = options.url ?? getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
      // Verify and persist the same target; read-only users need no token-management permission.
      const client = getApiClient({
        baseUrl,
        token,
      })

      try {
        // Verify token using a Bearer-auth-compatible endpoint
        await withSpinner(
          'Verifying token...',
          () => client.get('/api/context'),
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
      setBaseUrl(baseUrl)

      const tokenPreview = safeTokenPreview(token)
      logger.success('Authentication successful')
      logger.info(`  Token: ${tokenPreview}`)
      logger.info(`  API URL: ${baseUrl}`)
      return
    }

    // Interactive login — not yet implemented
    logger.newline()
    logger.info('To authenticate, create a CLI token in the Dashboard:')
    logger.info('  Dashboard → Organization Admin → CLI Tokens → Create Token')
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
      const context = await withSpinner(
        'Fetching context...',
        async () => {
          const { data } = await client.get<{
            success: boolean
            user: { id: string; role: string }
            organization: { id: string; name: string | null; slug: string | null }
            project: { id: string; name: string; slug: string | null }
          }>('/api/context')
          return data
        },
        { successText: 'Context loaded' },
      )

      const tokenPreview = safeTokenPreview(token)

      // Token metadata is optional: project viewers cannot list API keys.
      let tokens: Array<{ start: string; name: string; createdByName: string | null; expiresAt: string | null; lastRequest: string | null }> = []
      try {
        const { data } = await client.get<{ tokens: typeof tokens }>('/api/cli-tokens')
        tokens = data.tokens ?? []
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.statusCode === 403)) throw error
      }

      // Match the current token against the server's token list by prefix
      const activeToken = tokens.find((t) => t.start && token.startsWith(t.start.replace(/\.+$/, '')))

      // JSON output mode
      if (getOutputFormat() === 'json') {
        const jsonData: Record<string, unknown> = {
          user: activeToken?.createdByName ?? null,
          tokenName: activeToken?.name ?? null,
          tokenPreview,
          apiUrl: baseUrl ?? 'https://app.supercheck.io',
          expiresAt: activeToken?.expiresAt ?? null,
          lastUsed: activeToken?.lastRequest ?? null,
          userId: context.user.id,
          role: context.user.role,
          organization: context.organization,
          project: context.project,
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
      logger.info(`  Project: ${context.project.name} (${context.project.id})`)
      logger.info(`  Role:    ${context.user.role}`)
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

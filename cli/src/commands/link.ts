import { Command } from 'commander'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getApiClient } from '../api/client.js'
import { getStoredBaseUrl, getToken } from '../auth/store.js'
import { outputDetail } from '../output/formatter.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
import { planLink } from '../utils/link-config.js'
import { readSmallFile } from '../utils/safe-read.js'

const DEFAULT_API_URL = 'https://app.supercheck.io'
const CONFIG_NAMES = ['supercheck.config.ts', 'supercheck.config.mjs', 'supercheck.config.js']

export const linkCommand = new Command('link')
  .description('Point supercheck.config.ts at the organization and project you are logged in to')
  .option('--dry-run', 'Show the change without writing it')
  .option('--force', 'Replace an existing, different organization or project')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { dryRun?: boolean; force?: boolean; config?: string }) => {
    const token = getToken()
    if (!token) throw new CLIError('AUTH_REQUIRED: Run `supercheck login` first.', ExitCode.AuthError)
    const cwd = process.cwd()
    const file = options.config ? resolve(cwd, options.config) : CONFIG_NAMES.map((n) => resolve(cwd, n)).find((p) => existsSync(p))
    if (!file) throw new CLIError('No supercheck.config.ts found. Run `supercheck init --skip-examples` first.', ExitCode.ConfigError)
    const text = readSmallFile(file)
    if (text === null) throw new CLIError(`Cannot read ${file} (missing, too large, or not a regular file).`, ExitCode.ConfigError)

    // Only the stored login's own server is asked; the config file is treated as text, never executed.
    const apiUrl = (getStoredBaseUrl() ?? DEFAULT_API_URL).replace(/\/+$/, '')
    let data: { organization?: { id: string; slug?: string | null }; project?: { id: string; slug?: string | null } }
    try {
      ;({ data } = await getApiClient({ baseUrl: apiUrl, token }).get('/api/context'))
    } catch (error) {
      if (error instanceof ApiRequestError && [401, 403].includes(error.statusCode ?? 0)) {
        throw new CLIError('TOKEN_INVALID: The stored credential was rejected. Run `supercheck login --reauth`.', ExitCode.AuthError)
      }
      throw error
    }
    if (!data.organization?.id || !data.project?.id) throw new CLIError('The server returned no project context.', ExitCode.ApiError)

    const plan = planLink(text, { organization: data.organization, project: data.project, apiUrl }, options.force)
    if (plan.unrecognized) {
      throw new CLIError(`Could not find the organization/project in ${file}. Edit it by hand: organization "${data.organization.id}", project "${data.project.id}".`, ExitCode.ConfigError)
    }
    if (plan.conflicts.length > 0) {
      throw new CLIError(`CONTEXT_MISMATCH: ${file} targets ${plan.conflicts.map((c) => `${c.field} "${c.from}"`).join(', ')}, but you are logged in to a different project. Refusing to retarget silently; re-run with --force to replace it.`, ExitCode.ConfigError, { conflicts: plan.conflicts })
    }
    if (plan.changes.length > 0 && !options.dryRun) {
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, plan.text, { mode: 0o644 })
      renameSync(temp, file)
    }
    outputDetail({ linked: plan.changes.length > 0 || 'already', dryRun: Boolean(options.dryRun), file, changes: plan.changes, organization: data.organization.id, project: data.project.id }, { redact: false })
  })

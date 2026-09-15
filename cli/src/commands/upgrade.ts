import { Command } from 'commander'
import { spawn } from 'node:child_process'
import { logger } from '../utils/logger.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { confirmPrompt } from '../utils/prompt.js'
import { getOutputFormat, output } from '../output/formatter.js'
import { withSpinner } from '../utils/spinner.js'

const PACKAGE_NAME = '@supercheck/cli'
const RELEASE_TARGET_PATTERN = /^(latest|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

function normalizeTag(tag: string): string {
  const trimmed = tag.trim()
  if (trimmed.startsWith('v') && trimmed.length > 1 && /\d/.test(trimmed[1])) {
    return trimmed.slice(1)
  }
  return trimmed
}

function getDefaultTag(): string {
  return 'latest'
}

function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  const userAgent = process.env.npm_config_user_agent ?? ''
  if (userAgent.includes('pnpm')) return 'pnpm'
  if (userAgent.includes('yarn')) return 'yarn'
  if (userAgent.includes('bun')) return 'bun'
  return 'npm'
}

function buildInstallCommand(
  pm: 'npm' | 'yarn' | 'pnpm' | 'bun',
  pkgSpec: string,
): { command: string; args: string[]; preview: string } {
  switch (pm) {
    case 'yarn': {
      const args = ['global', 'add', pkgSpec]
      return { command: 'yarn', args, preview: `yarn ${args.join(' ')}` }
    }
    case 'pnpm': {
      const args = ['add', '-g', pkgSpec]
      return { command: 'pnpm', args, preview: `pnpm ${args.join(' ')}` }
    }
    case 'bun': {
      const args = ['add', '-g', pkgSpec]
      return { command: 'bun', args, preview: `bun ${args.join(' ')}` }
    }
    case 'npm':
    default: {
      const args = ['install', '-g', pkgSpec]
      return { command: 'npm', args, preview: `npm ${args.join(' ')}` }
    }
  }
}

function runInstallCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => resolve(code ?? 0))
  })
}

export const upgradeCommand = new Command('upgrade')
  .description('Upgrade the Supercheck CLI to the latest version')
  .option('--tag <tag>', 'Release target to install (latest or explicit version)')
  .option('--package-manager <pm>', 'Package manager to use (npm, yarn, pnpm, bun)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--dry-run', 'Print the upgrade command without running it')
  .action(async (options: { tag?: string; packageManager?: string; yes?: boolean; dryRun?: boolean }) => {
    const format = getOutputFormat()
    const tag = normalizeTag(options.tag ?? getDefaultTag())

    if (!RELEASE_TARGET_PATTERN.test(tag)) {
      throw new CLIError(
        `Invalid target "${tag}". Use "latest" or an explicit version (for example 0.1.1-rc.2).`,
        ExitCode.ConfigError,
      )
    }

    const pm = (options.packageManager ?? detectPackageManager()) as 'npm' | 'yarn' | 'pnpm' | 'bun'
    if (!['npm', 'yarn', 'pnpm', 'bun'].includes(pm)) {
      throw new CLIError(
        `Unsupported package manager "${pm}". Use npm, yarn, pnpm, or bun.`,
        ExitCode.ConfigError,
      )
    }

    const pkgSpec = `${PACKAGE_NAME}@${tag}`
    const install = buildInstallCommand(pm, pkgSpec)

    if (options.dryRun) {
      const payload = {
        action: 'upgrade',
        package: PACKAGE_NAME,
        tag,
        packageManager: pm,
        command: install.preview,
        dryRun: true,
      }

      if (format === 'json') {
        output(payload)
      } else {
        logger.info(`Upgrade command: ${install.preview}`)
      }
      return
    }

    if (!options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new CLIError(
          'Upgrade requires confirmation. Re-run with --yes to skip the prompt.',
          ExitCode.ConfigError,
        )
      }

      const confirmed = await confirmPrompt(`Upgrade Supercheck CLI using ${pm}?`, { default: false })
      if (!confirmed) {
        logger.info('Upgrade cancelled.')
        return
      }
    }

    let code = 0
    try {
      code = await withSpinner(
        'Upgrading Supercheck CLI...',
        () => runInstallCommand(install.command, install.args),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new CLIError(`Failed to run upgrade command: ${message}`, ExitCode.GeneralError)
    }
    if (code !== 0) {
      throw new CLIError(`Upgrade failed with exit code ${code}.`, ExitCode.GeneralError)
    }

    if (format === 'json') {
      output({
        action: 'upgrade',
        package: PACKAGE_NAME,
        tag,
        packageManager: pm,
        command: install.preview,
        success: true,
      })
      return
    }

    logger.success(`Supercheck CLI upgraded (${pkgSpec}).`)
  })

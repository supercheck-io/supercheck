import { CLIError, ExitCode } from './errors.js'
import { getOutputFormat } from '../output/formatter.js'
/**
 * Shared confirmation prompt utility.
 * Standardizes all CLI prompts to use `(yes/no)` format.
 */

/**
 * Prompt the user for a yes/no confirmation.
 *
 * @param message - The question to ask (e.g. "Delete resource X?")
 * @param opts.default - What pressing Enter (empty input) means.
 *                       `true` = default yes, `false` = default no (default: false)
 * @returns true if the user confirmed, false otherwise
 */
export async function confirmPrompt(
  message: string,
  opts: { default?: boolean; changes?: unknown[]; context?: unknown } = {},
): Promise<boolean> {
  if (!process.stdin.isTTY || getOutputFormat() === 'json') {
    throw new CLIError(`CONFIRMATION_REQUIRED: ${message} Re-run with --force (or --yes for upgrade) after reviewing the preview.`, ExitCode.ConfigError, { status: 'confirmation_required', changes: opts.changes ?? [message], context: opts.context, confirmArgs: [...process.argv.slice(2), process.argv.includes('upgrade') ? '--yes' : '--force'] })
  }
  const defaultYes = opts.default === true
  const hint = defaultYes ? '(yes/no) [yes]' : '(yes/no) [no]'

  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stderr })

  const answer = await new Promise<string | null>((resolve) => {
    rl.once('close', () => resolve(null))
    rl.question(`${message} ${hint} `, resolve)
  })
  rl.close()

  if (answer === null) throw new CLIError('ABORTED: Input closed before confirmation.', ExitCode.ConfigError)
  const normalized = answer.trim().toLowerCase()

  // Empty input → use default
  if (normalized === '' && defaultYes) return true

  // Accept yes/y and no/n
  if (normalized === 'yes' || normalized === 'y') return true
  throw new CLIError('ABORTED: Operation cancelled.', ExitCode.ConfigError)
}

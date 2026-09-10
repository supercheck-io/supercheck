import ora, { type Ora } from 'ora'
import { getOutputFormat } from '../output/formatter.js'
import { logger } from './logger.js'

/**
 * Create a spinner for long-running operations.
 * Spinners are disabled in JSON/quiet mode for clean output.
 */
export function createSpinner(text: string): Ora {
  const format = getOutputFormat()
  const isInteractive = format === 'table'

  const spinner = ora({
    text,
    // Disable spinner in non-interactive modes
    isSilent: !isInteractive,
    // Use dots style for a clean look
    spinner: 'dots',
  })

  return spinner
}

/**
 * Run an async operation with a spinner.
 * Shows success/failure automatically.
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  options?: {
    successText?: string | ((result: T) => string)
    failText?: string
  },
): Promise<T> {
  const spinner = createSpinner(text)
  spinner.start()

  try {
    const result = await fn()
    const successMessage =
      typeof options?.successText === 'function'
        ? options.successText(result)
        : options?.successText ?? text.replace(/\.\.\.?$/, '')

    spinner.succeed(successMessage)
    return result
  } catch (error) {
    const failMessage = options?.failText ?? text.replace(/\.\.\.?$/, ' failed')
    spinner.fail(failMessage)
    throw error
  }
}

/**
 * Simple spinner for manual control.
 */
export function startSpinner(text: string): {
  succeed: (text?: string) => void
  fail: (text?: string) => void
  update: (text: string) => void
  stop: () => void
} {
  const format = getOutputFormat()
  const isInteractive = format === 'table'

  if (!isInteractive) {
    // In non-interactive mode, just log and return no-ops
    logger.info(text)
    return {
      succeed: (msg) => msg && logger.success(msg),
      fail: (msg) => msg && logger.error(msg),
      update: () => {},
      stop: () => {},
    }
  }

  const spinner = ora({ text, spinner: 'dots' }).start()

  return {
    succeed: (msg) => spinner.succeed(msg),
    fail: (msg) => spinner.fail(msg),
    update: (msg) => {
      spinner.text = msg
    },
    stop: () => spinner.stop(),
  }
}

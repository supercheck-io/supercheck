import ora, { type Ora } from 'ora'
import pc, { colorEnabled } from './colors.js'
import { getOutputFormat } from '../output/formatter.js'

/**
 * Create a spinner for long-running operations.
 * Spinners are disabled in JSON/quiet mode for clean output.
 */
export function createSpinner(text: string): Ora {
  const format = getOutputFormat()
  const isInteractive = format === 'table' && Boolean(process.stdin.isTTY && process.stderr.isTTY) && process.stderr.columns > 0

  const spinner = ora({
    text,
    color: colorEnabled() ? 'cyan' : false,
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
  const started = Date.now()
  const progress = setInterval(() => { spinner.text = `${text} ${Math.floor((Date.now() - started) / 1000)}s` }, 1000)

  try {
    const result = await fn()
    const successMessage =
      typeof options?.successText === 'function'
        ? options.successText(result)
        : options?.successText ?? text.replace(/\.\.\.?$/, '')

    spinner.stopAndPersist({ symbol: pc.green('✓'), text: successMessage })
    return result
  } catch (error) {
    const failMessage = options?.failText ?? text.replace(/\.\.\.?$/, ' failed')
    spinner.stopAndPersist({ symbol: pc.red('✗'), text: failMessage })
    throw error
  } finally {
    clearInterval(progress)
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
  const spinner = createSpinner(text).start()

  return {
    succeed: (msg) => spinner.stopAndPersist({ symbol: pc.green('✓'), text: msg }),
    fail: (msg) => spinner.stopAndPersist({ symbol: pc.red('✗'), text: msg }),
    update: (msg) => {
      spinner.text = msg
    },
    stop: () => spinner.stop(),
  }
}

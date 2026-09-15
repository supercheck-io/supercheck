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
  opts: { default?: boolean } = {},
): Promise<boolean> {
  const defaultYes = opts.default === true
  const hint = defaultYes ? '(yes/no) [yes]' : '(yes/no) [no]'

  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stderr })

  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} ${hint} `, resolve)
  })
  rl.close()

  const normalized = answer.trim().toLowerCase()

  // Empty input → use default
  if (normalized === '') return defaultYes

  // Accept yes/y and no/n
  return normalized === 'yes' || normalized === 'y'
}

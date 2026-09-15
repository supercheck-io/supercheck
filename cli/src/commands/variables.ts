import { Command } from 'commander'
import { Buffer } from 'node:buffer'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { withSpinner } from '../utils/spinner.js'

interface Variable {
  id: string
  key: string
  value?: string
  type: 'variable' | 'secret' | 'file'
  isSecret: boolean
  description?: string | null
  fileName?: string | null
  fileSize?: number | null
  mimeType?: string | null
  createdAt?: string
}

async function readValueFromStdin(): Promise<string> {
  const MAX_STDIN_BYTES = 1024 * 1024 // 1 MB
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of process.stdin) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    totalBytes += buf.length
    if (totalBytes > MAX_STDIN_BYTES) {
      throw new CLIError('Stdin input exceeds 1 MB limit.', ExitCode.GeneralError)
    }
    chunks.push(buf)
  }

  return Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '')
}

export const varCommand = new Command('var')
  .description('Manage project variables')

varCommand
  .command('list')
  .description('List all variables')
  .action(async () => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching variables',
      () => client.get<Variable[]>('/api/variables'),
    )

    output(data as unknown as Record<string, unknown>[], {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'key', header: 'Key' },
        { key: 'type', header: 'Type' },
        { key: 'fileName', header: 'File Name' },
        { key: 'fileSize', header: 'File Size' },
        { key: 'createdAt', header: 'Created' },
      ],
    })
  })

varCommand
  .command('get <key>')
  .description('Get a variable by key name')
  .action(async (key: string) => {
    const client = createAuthenticatedClient()
    const { data: variables } = await withSpinner(
      'Fetching variable',
      () => client.get<Variable[]>('/api/variables'),
    )

    const variable = variables.find((v) => v.key === key)
    if (!variable) {
      throw new CLIError(`Variable "${key}" not found`, ExitCode.GeneralError)
    }

    const detail: Record<string, unknown> = { ...variable }
    if (variable.type === 'file') {
      detail.value = `[FILE: ${variable.fileName ?? 'unknown'}]`
    }
    outputDetail(detail)
  })

varCommand
  .command('set <key> [value]')
  .description('Create or update a variable')
  .option('--secret', 'Mark as secret (value will be encrypted)')
  .option('--value-stdin', 'Read the variable value from stdin')
  .option('--description <description>', 'Variable description')
  .action(async (key: string, value: string | undefined, options: { secret?: boolean; valueStdin?: boolean; description?: string }) => {
    const client = createAuthenticatedClient()

    if (options.valueStdin && value !== undefined) {
      throw new CLIError('Use either a positional <value> or --value-stdin, not both.', ExitCode.ConfigError)
    }

    let resolvedValue = value
    if (options.valueStdin) {
      resolvedValue = await readValueFromStdin()
    }

    if (resolvedValue === undefined) {
      throw new CLIError('Missing variable value. Provide <value> or pass --value-stdin.', ExitCode.ConfigError)
    }

    if (options.secret && value !== undefined) {
      logger.warn('Passing secret values as CLI arguments exposes them to shell history. Prefer --value-stdin.')
    }

    // Check if variable exists
    const { data: variables } = await withSpinner(
      'Checking existing variables',
      () => client.get<Variable[]>('/api/variables'),
    )
    const existing = variables.find((v) => v.key === key)

    if (existing) {
      if (existing.type === 'file') {
        throw new CLIError('File-type variables cannot be modified via the CLI. Use the dashboard to manage file uploads.', ExitCode.GeneralError)
      }

      await withSpinner(
        'Updating variable',
        () => client.put(`/api/variables/${existing.id}`, {
          key,
          value: resolvedValue,
          isSecret: options.secret ?? existing.isSecret,
          ...(options.description !== undefined && { description: options.description }),
        }),
      )
      logger.success(`Variable "${key}" updated`)
    } else {
      await withSpinner(
        'Creating variable',
        () => client.post('/api/variables', {
          key,
          value: resolvedValue,
          isSecret: options.secret ?? false,
          ...(options.description !== undefined && { description: options.description }),
        }),
      )
      logger.success(`Variable "${key}" created`)
    }
  })

varCommand
  .command('delete <key>')
  .description('Delete a variable')
  .option('--force', 'Skip confirmation')
  .action(async (key: string, options: { force?: boolean }) => {
    const client = createAuthenticatedClient()

    const { data: variables } = await withSpinner(
      'Fetching variables',
      () => client.get<Variable[]>('/api/variables'),
    )
    const variable = variables.find((v) => v.key === key)

    if (!variable) {
      throw new CLIError(`Variable "${key}" not found`, ExitCode.GeneralError)
    }

    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      const confirmed = await confirmPrompt(`Delete variable "${key}"?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    await withSpinner(
      'Deleting variable',
      () => client.delete(`/api/variables/${variable.id}`),
    )
    logger.success(`Variable "${key}" deleted`)
  })

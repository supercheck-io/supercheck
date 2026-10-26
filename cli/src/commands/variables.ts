import { Command } from 'commander'
import { Buffer } from 'node:buffer'
import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail, outputMutation } from '../output/formatter.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
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
      throw new ApiRequestError(`Variable "${key}" not found`, 404)
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
    if (key.length < 4 || key.length > 20) throw new CLIError('Variable key must be 4–20 characters.', ExitCode.ConfigError)
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
        throw new CLIError('File-type variables cannot be modified via the CLI. Delete the variable and recreate it with `var upload`, or use the dashboard.', ExitCode.GeneralError)
      }

      const { data } = await withSpinner(
        'Updating variable',
        () => client.put<Record<string, unknown>>(`/api/variables/${existing.id}`, {
          key,
          value: resolvedValue,
          isSecret: options.secret ?? existing.isSecret,
          ...(options.description !== undefined && { description: options.description }),
        }),
      )
      logger.success(`Variable "${key}" updated`)
      outputMutation({ ...data, id: existing.id, key, action: 'updated' })
    } else {
      const { data } = await withSpinner(
        'Creating variable',
        () => client.post<Record<string, unknown>>('/api/variables', {
          key,
          value: resolvedValue,
          isSecret: options.secret ?? false,
          ...(options.description !== undefined && { description: options.description }),
        }),
      )
      logger.success(`Variable "${key}" created`)
      outputMutation({ ...data, key, action: 'created' })
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
      await confirmPrompt(`Delete variable "${key}"?`, { default: false })
    }

    await withSpinner(
      'Deleting variable',
      () => client.delete(`/api/variables/${variable.id}`),
    )
    logger.success(`Variable "${key}" deleted`)
    outputMutation({ id: variable.id, key, deleted: true })
  })

const FILE_VARIABLE_KEY = /^[A-Z][A-Z0-9_]{3,19}$/
const FILE_VARIABLE_EXTENSIONS = new Set(['.csv', '.json', '.txt', '.tsv', '.xml', '.yaml', '.yml'])
const MAX_FILE_VARIABLE_BYTES = 5 * 1024 * 1024
// Server-provided names may contain terminal escape sequences.
const stripControl = (text: string) => [...text].filter((char) => char >= ' ' && char !== '\u007f').join('')

async function getProjectId(client: ReturnType<typeof createAuthenticatedClient>): Promise<string> {
  const { data } = await client.get<{ project: { id: string } }>('/api/context')
  return data.project.id
}

varCommand
  .command('upload <key> <file>')
  .description('Create a file variable from a local file (.csv, .json, .txt, .tsv, .xml, .yaml, .yml; max 5 MB)')
  .option('--description <description>', 'Variable description')
  .action(async (key: string, file: string, options: { description?: string }) => {
    if (!FILE_VARIABLE_KEY.test(key)) {
      throw new CLIError('Variable key must be 4–20 characters: an uppercase letter, then uppercase letters, digits or underscores.', ExitCode.ConfigError)
    }
    if (!FILE_VARIABLE_EXTENSIONS.has(extname(file).toLowerCase())) {
      throw new CLIError(`File type must be one of ${[...FILE_VARIABLE_EXTENSIONS].join(' ')}.`, ExitCode.ConfigError)
    }
    // Checked before reading so a directory, device or oversized file is never loaded into memory.
    const info = await stat(file).catch(() => { throw new CLIError(`Cannot read ${file}.`, ExitCode.ConfigError) })
    if (!info.isFile()) throw new CLIError(`${file} is not a regular file.`, ExitCode.ConfigError)
    if (info.size > MAX_FILE_VARIABLE_BYTES) throw new CLIError('File variables are limited to 5 MB.', ExitCode.ConfigError)
    const client = createAuthenticatedClient()
    const form = new FormData()
    form.set('key', key)
    if (options.description !== undefined) form.set('description', options.description)
    form.set('file', new File([await readFile(file)], basename(file)))
    const projectId = await getProjectId(client)
    const { data } = await withSpinner(
      'Uploading file variable',
      () => client.post<{ data?: Record<string, unknown> }>(`/api/projects/${encodeURIComponent(projectId)}/variables`, form),
    )
    logger.success(`File variable "${key}" created`)
    outputMutation({ ...(data.data ?? data), key, action: 'created' })
  })

varCommand
  .command('download <key>')
  .description('Print a file variable\'s content, or save it with --out')
  .option('--out <path>', 'Write to a new file instead of stdout (owner-only permissions on macOS and Linux)')
  .option('--force', 'Overwrite --out if it already exists')
  .action(async (key: string, options: { out?: string; force?: boolean }) => {
    const client = createAuthenticatedClient()
    const { data: variables } = await withSpinner('Fetching variable', () => client.get<Variable[]>('/api/variables'))
    const variable = variables.find((v) => v.key === key)
    if (!variable) throw new ApiRequestError(`Variable "${key}" not found`, 404)
    if (variable.type !== 'file') throw new CLIError(`Variable "${key}" is not a file variable.`, ExitCode.GeneralError)
    const projectId = await getProjectId(client)
    const { data: content } = await withSpinner(
      'Downloading file variable',
      () => client.getBytes(`/api/projects/${encodeURIComponent(projectId)}/variables/${encodeURIComponent(variable.id)}/download`),
    )
    if (options.out) {
      // The content may be a secret: create the file owner-only (POSIX mode; Windows ignores it) and refuse to replace (or follow a symlink at) an existing path.
      await writeFile(options.out, content, { mode: 0o600, flag: options.force ? 'w' : 'wx' }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') throw new CLIError(`${options.out} already exists. Use --force to overwrite it.`, ExitCode.ConfigError)
        throw new CLIError(`Cannot write ${options.out}: ${error.code ?? error.message}`, ExitCode.ConfigError)
      })
      if (options.force) await chmod(options.out, 0o600)
      logger.success(`Saved ${stripControl(variable.fileName ?? key)} to ${options.out}`)
      outputMutation({ id: variable.id, key, path: options.out })
    } else {
      process.stdout.write(content)
    }
  })

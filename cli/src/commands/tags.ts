import { CLIError, ExitCode } from '../utils/errors.js'
import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail } from '../output/formatter.js'
import { withSpinner } from '../utils/spinner.js'

export const tagCommand = new Command('tag')
  .description('Manage tags')

tagCommand
  .command('list')
  .description('List all tags')
  .action(async () => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching tags',
      () => client.get<Record<string, unknown>[]>('/api/tags'),
    )

    output(data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'color', header: 'Color' },
      ],
    })
  })

tagCommand
  .command('create <name>')
  .description('Create a new tag')
  .option('--color <color>', 'Tag color (hex)')
  .action(async (name: string, options: { color?: string }) => {
    if (name.length < 3 || name.length > 20) throw new CLIError('Tag name must be 3–20 characters.', ExitCode.ConfigError)
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Creating tag',
      () => client.post<Record<string, unknown>>('/api/tags', {
        name,
        color: options.color,
      }),
    )

    logger.success(`Tag "${name}" created (${data.id})`)
    outputDetail(data)
  })

tagCommand
  .command('delete <id>')
  .description('Delete a tag')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      const confirmed = await confirmPrompt(`Delete tag ${id}?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting tag',
      () => client.delete(`/api/tags/${id}`),
    )
    logger.success(`Tag ${id} deleted`)
  })

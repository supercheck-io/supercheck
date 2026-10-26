import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputMutation } from '../output/formatter.js'
import { parseIntStrict } from '../utils/number.js'
import { withSpinner } from '../utils/spinner.js'

export const tokenCommand = new Command('token').alias('tokens').description('Manage CLI tokens for the current project')

tokenCommand.command('list').description('List CLI tokens').action(async () => {
  const { data } = await withSpinner('Fetching CLI tokens', () =>
    createAuthenticatedClient().get<{ tokens: Record<string, unknown>[] }>('/api/cli-tokens'))
  output(data.tokens, { columns: [
    { key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }, { key: 'start', header: 'Prefix' },
    { key: 'enabled', header: 'Enabled' }, { key: 'expiresAt', header: 'Expires' }, { key: 'lastRequest', header: 'Last Used' },
  ] })
})

tokenCommand
  .command('create <name>')
  .description('Create a CLI token (the secret is shown once)')
  .option('--expires-in <days>', 'Expire after N days (1-365)')
  .action(async (name: string, options: { expiresIn?: string }) => {
    const expiresIn = options.expiresIn === undefined ? undefined : parseIntStrict(options.expiresIn, '--expires-in', { min: 1, max: 365 }) * 86400
    const { data } = await withSpinner('Creating CLI token', () =>
      createAuthenticatedClient().post<{ token: Record<string, unknown> }>('/api/cli-tokens', { name, ...(expiresIn && { expiresIn }) }))
    logger.success(`CLI token "${name}" created. Copy the key now; it is not shown again.`)
    outputMutation({ ...data.token, action: 'created' })
  })

for (const [verb, enabled] of [['enable', true], ['disable', false]] as const) {
  tokenCommand.command(`${verb} <id>`).description(`${verb[0].toUpperCase()}${verb.slice(1)} a CLI token`).action(async (id: string) => {
    await withSpinner(`${verb === 'enable' ? 'Enabling' : 'Disabling'} CLI token`, () =>
      createAuthenticatedClient().patch(`/api/cli-tokens/${id}`, { enabled }))
    logger.success(`CLI token ${id} ${verb}d`)
    outputMutation({ id, enabled })
  })
}

tokenCommand
  .command('revoke <id>')
  .description('Permanently revoke a CLI token')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Revoke CLI token ${id}? Anything using it will stop working.`, { default: false })
    }
    await withSpinner('Revoking CLI token', () => createAuthenticatedClient().delete(`/api/cli-tokens/${id}`))
    logger.success(`CLI token ${id} revoked`)
    outputMutation({ id, revoked: true })
  })

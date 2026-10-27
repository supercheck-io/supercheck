import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output } from '../output/formatter.js'
import { withSpinner } from '../utils/spinner.js'

export const projectCommand = new Command('project').alias('projects').description('Inspect projects')

projectCommand.command('list').description('List projects visible to the current token').action(async () => {
  const { data } = await withSpinner('Fetching projects', () =>
    createAuthenticatedClient().get<{ data: Record<string, unknown>[] }>('/api/projects'))
  output(data.data, { columns: [
    { key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }, { key: 'slug', header: 'Slug' }, { key: 'organizationId', header: 'Organization' },
  ] })
})

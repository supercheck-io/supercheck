import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output } from '../output/formatter.js'
import { withSpinner } from '../utils/spinner.js'
import { isUuid } from '../utils/paths.js'
import { CLIError, ExitCode } from '../utils/errors.js'

export const projectCommand = new Command('project').alias('projects').description('Inspect projects')

projectCommand.command('list').description('List projects visible to the current token').action(async () => {
  const { data } = await withSpinner('Fetching projects', () =>
    createAuthenticatedClient().get<{ data: Record<string, unknown>[] }>('/api/projects'))
  output(data.data, { columns: [
    { key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }, { key: 'slug', header: 'Slug' }, { key: 'organizationId', header: 'Organization' },
  ] })
})

projectCommand
  .command('members [projectId]')
  .description('List project members and their roles (defaults to the current project)')
  .action(async (projectId?: string) => {
    const client = createAuthenticatedClient()
    const id = projectId ?? (await client.get<{ project: { id: string } }>('/api/context')).data.project.id
    if (!isUuid(id)) throw new CLIError('projectId must be a valid UUID.', ExitCode.ConfigError)
    const { data } = await withSpinner('Fetching members', () =>
      client.get<{ members: { userId: string; role: string; user: { name: string | null; email: string } }[] }>(`/api/projects/${encodeURIComponent(id)}/members`))
    output(data.members.map((m) => ({ id: m.userId, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })), {
      columns: [{ key: 'userId', header: 'User ID' }, { key: 'name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'role', header: 'Role' }],
    })
  })

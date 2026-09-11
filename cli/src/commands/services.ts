import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output, outputDetail } from '../output/formatter.js'
import { withSpinner } from '../utils/spinner.js'

export const serviceCommand = new Command('service').alias('services').description('Inspect the AI SRE service catalog')

serviceCommand.command('list').description('List services').action(async () => {
  const { data } = await withSpinner('Fetching services', () => createAuthenticatedClient().get<{ services: Record<string, unknown>[] }>('/api/sre/services'))
  output(data.services, { columns: [
    { key: 'id', header: 'ID' }, { key: 'name', header: 'Name' }, { key: 'tier', header: 'Tier' },
    { key: 'environment', header: 'Environment' }, { key: 'ownerTeam', header: 'Owner' }, { key: 'status', header: 'Status' },
  ] })
})

async function getService(id: string) {
  return withSpinner('Fetching service', () => createAuthenticatedClient().get<Record<string, unknown>>(`/api/sre/services/${id}`))
}

serviceCommand.command('get <id>').description('Get service details, health, and dependencies').action(async (id: string) => {
  const { data } = await getService(id)
  outputDetail(data)
})

serviceCommand.command('health <id>').description('Get the latest service health snapshot').action(async (id: string) => {
  const { data } = await getService(id)
  outputDetail(((data.health as Record<string, unknown> | null) ?? { health: 'unknown' }))
})

serviceCommand.command('dependencies <id>').description('List upstream and downstream dependencies').action(async (id: string) => {
  const { data } = await getService(id)
  output((data.dependencies as Record<string, unknown>[]) ?? [])
})

import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output, outputDetail } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'

type IncidentEnvelope = { incidents: Record<string, unknown>[] }

export const incidentCommand = new Command('incident').alias('incidents').description('Manage AI SRE incidents')

incidentCommand.command('list')
  .description('List incidents')
  .option('--status <status>', 'Filter by incident status')
  .option('--severity <severity>', 'Filter by severity (sev1, sev2, sev3, sev4)')
  .action(async (options: { status?: string; severity?: string }) => {
    const { data } = await withSpinner('Fetching incidents', () => createAuthenticatedClient().get<IncidentEnvelope>('/api/sre/incidents', options))
    output(data.incidents, { columns: [
      { key: 'incidentNumber', header: '#' }, { key: 'severity', header: 'Severity' },
      { key: 'status', header: 'Status' }, { key: 'title', header: 'Title' },
      { key: 'primaryServiceName', header: 'Service' }, { key: 'updatedAt', header: 'Updated' },
    ] })
  })

incidentCommand.command('get <id>').description('Get incident details').action(async (id: string) => {
  const { data } = await withSpinner('Fetching incident', () => createAuthenticatedClient().get<{ incident: Record<string, unknown> }>(`/api/sre/incidents/${id}`))
  outputDetail(data.incident)
})

incidentCommand.command('timeline <id>').description('Show the incident timeline').action(async (id: string) => {
  const { data } = await withSpinner('Fetching incident timeline', () => createAuthenticatedClient().get<{ events: Record<string, unknown>[] }>(`/api/sre/incidents/${id}/timeline`))
  output(data.events, { columns: [
    { key: 'createdAt', header: 'Time' }, { key: 'eventType', header: 'Event' },
    { key: 'actorType', header: 'Actor' }, { key: 'eventData', header: 'Details' },
  ] })
})

incidentCommand.command('resolve <id>')
  .description('Resolve an incident with an audit comment')
  .requiredOption('--comment <comment>', 'Resolution summary')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { comment: string; force?: boolean }) => {
    if (!options.force && !await confirmPrompt(`Resolve incident ${id}?`, { default: false })) {
      logger.info('Aborted')
      return
    }
    const { data } = await withSpinner('Resolving incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${id}/resolve`, { comment: options.comment }))
    logger.success('Incident resolved')
    outputDetail(data)
  })

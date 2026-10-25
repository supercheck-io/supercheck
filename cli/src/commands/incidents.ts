import { Command, Option } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, output, outputDetail } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { resolveIncidentId } from '../utils/incidents.js'

type IncidentEnvelope = { incidents: Record<string, unknown>[] }

export const incidentCommand = new Command('incident').alias('incidents').description('Manage AI SRE incidents')

incidentCommand.command('list')
  .description('List incidents')
  .addOption(new Option('--status <status>', 'Filter by incident status (open = not resolved)').choices(['open', 'triggered', 'investigating', 'identified', 'recommendations_ready', 'user_applying_fix', 'verifying', 'resolved']))
  .addOption(new Option('--severity <severity>', 'Filter by severity').choices(['sev1', 'sev2', 'sev3', 'sev4']))
  .action(async (options: { status?: string; severity?: string }) => {
    const { data } = await withSpinner('Fetching incidents', () => createAuthenticatedClient().get<IncidentEnvelope>('/api/sre/incidents', options))
    output(data.incidents, { columns: [
      { key: 'incidentNumber', header: '#' }, { key: 'severity', header: 'Severity' },
      { key: 'status', header: 'Status' }, { key: 'title', header: 'Title' },
      { key: 'primaryServiceName', header: 'Service' }, { key: 'updatedAt', header: 'Updated' },
    ] })
  })

incidentCommand.command('get <id>').description('Get incident details by number or UUID').action(async (id: string) => {
  id = await resolveIncidentId(id)
  const { data } = await withSpinner('Fetching incident', () => createAuthenticatedClient().get<{ incident: Record<string, unknown> }>(`/api/sre/incidents/${id}`))
  outputDetail(data.incident)
})

incidentCommand.command('timeline <id>').description('Show the incident timeline by number or UUID').action(async (id: string) => {
  id = await resolveIncidentId(id)
  const { data } = await withSpinner('Fetching incident timeline', () => createAuthenticatedClient().get<{ events: Record<string, unknown>[] }>(`/api/sre/incidents/${id}/timeline`))
  output(data.events, { columns: [
    { key: 'createdAt', header: 'Time' }, { key: 'eventType', header: 'Event' },
    { key: 'actorType', header: 'Actor' }, { key: 'eventData', header: 'Details' },
  ] })
})

incidentCommand.command('resolve <id>')
  .description('Resolve an incident by number or UUID with an audit comment')
  .requiredOption('--comment <comment>', 'Resolution summary')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { comment: string; force?: boolean }) => {
    const label = /^\d+$/.test(id) ? `#${id}` : id
    id = await resolveIncidentId(id)
    if (!options.force) {
      if (!process.stdin.isTTY || getOutputFormat() === 'json') {
        throw new CLIError('Refusing to resolve without confirmation in a non-interactive session. Pass --force to proceed.', ExitCode.ConfigError)
      }
      await confirmPrompt(`Resolve incident ${label}?`, { default: false })
    }
    const { data } = await withSpinner('Resolving incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${id}/resolve`, { comment: options.comment }, { retries: 0 }))
    if (data.alreadyResolved === true) logger.info(typeof data.message === 'string' ? data.message : 'Incident was already resolved')
    else logger.success('Incident resolved')
    outputDetail(data)
  })

import { Command, Option } from 'commander'
import { z } from 'zod'
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
  .option('--assignee <assignee>', 'Filter by assignee: me, unassigned or a user UUID')
  .action(async (options: { status?: string; severity?: string; assignee?: string }) => {
    const { data } = await withSpinner('Fetching incidents', () => createAuthenticatedClient().get<IncidentEnvelope>('/api/sre/incidents', options))
    output(data.incidents, { columns: [
      { key: 'incidentNumber', header: '#' }, { key: 'severity', header: 'Severity' },
      { key: 'status', header: 'Status' }, { key: 'title', header: 'Title' },
      { key: 'primaryServiceName', header: 'Service' }, { key: 'assigneeUserId', header: 'Assignee' },
      { key: 'acknowledgedAt', header: 'Acked' }, { key: 'updatedAt', header: 'Updated' },
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
  .description('Resolve an incident by number or UUID with a resolution summary')
  .option('--summary <summary>', 'Resolution summary')
  .option('--comment <comment>', 'Alias for --summary')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { summary?: string; comment?: string; force?: boolean }) => {
    const summary = options.summary?.trim() || options.comment?.trim()
    if (!summary) throw new CLIError('A resolution summary is required: pass --summary "<text>".', ExitCode.ConfigError)
    const label = /^\d+$/.test(id) ? `#${id}` : id
    id = await resolveIncidentId(id)
    if (!options.force) {
      if (!process.stdin.isTTY || getOutputFormat() === 'json') {
        throw new CLIError('Refusing to resolve without confirmation in a non-interactive session. Pass --force to proceed.', ExitCode.ConfigError)
      }
      await confirmPrompt(`Resolve incident ${label}?`, { default: false })
    }
    const { data } = await withSpinner('Resolving incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${id}/resolve`, { resolutionSummary: summary }, { retries: 0 }))
    if (data.alreadyResolved === true) logger.info(typeof data.message === 'string' ? data.message : 'Incident was already resolved')
    else logger.success('Incident resolved')
    outputDetail(data)
  })

async function setAssignee(id: string, assigneeUserId: string | null, commander: boolean | undefined): Promise<void> {
  id = await resolveIncidentId(id)
  const role = commander ? 'commander' : 'assignee'
  const { data } = await withSpinner('Updating incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${id}/assign`, { assigneeUserId, role }, { retries: 0 }))
  logger.success(typeof data.message === 'string' ? data.message : 'Incident updated')
  outputDetail(data)
}

incidentCommand.command('assign <id>')
  .description('Assign an incident (or its commander) to a project editor or admin')
  .requiredOption('--user <user>', 'User UUID, or "me" for the token owner')
  .option('--commander', 'Set the incident commander instead of the assignee')
  .action(async (id: string, options: { user: string; commander?: boolean }) => {
    let userId = options.user
    if (userId === 'me') {
      const { data } = await createAuthenticatedClient().get<{ user?: { id?: string } }>('/api/context')
      if (!data.user?.id) throw new CLIError('Could not resolve the current user. Pass a user UUID instead.', ExitCode.ApiError)
      userId = data.user.id
    } else if (!z.string().uuid().safeParse(userId).success) {
      throw new CLIError('--user must be "me" or a user UUID.', ExitCode.ConfigError)
    }
    await setAssignee(id, userId, options.commander)
  })

incidentCommand.command('unassign <id>')
  .description('Clear the incident assignee (or commander)')
  .option('--commander', 'Clear the incident commander instead of the assignee')
  .action((id: string, options: { commander?: boolean }) => setAssignee(id, null, options.commander))

incidentCommand.command('ack <id>')
  .alias('acknowledge')
  .description('Acknowledge an incident by number or UUID')
  .action(async (id: string) => {
    id = await resolveIncidentId(id)
    const { data } = await withSpinner('Acknowledging incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${id}/acknowledge`, {}, { retries: 0 }))
    if (data.alreadyAcknowledged === true) logger.info(typeof data.message === 'string' ? data.message : 'Incident was already acknowledged')
    else logger.success('Incident acknowledged')
    outputDetail(data)
  })

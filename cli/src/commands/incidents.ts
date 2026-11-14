import { Command, Option } from 'commander'
import { z } from 'zod'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, output, outputDetail } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
import { resolveIncidentId } from '../utils/incidents.js'

type IncidentEnvelope = { incidents: Record<string, unknown>[]; truncated?: boolean }

/** An older server has no such route: Next answers 404 without the JSON `error` body a real "not found" carries. */
async function withRouteCheck<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const body = error instanceof ApiRequestError ? error.responseBody : undefined
    const hasJsonError = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    if (error instanceof ApiRequestError && error.statusCode === 404 && !hasJsonError) {
      throw new CLIError('This command requires a newer Supercheck server. Upgrade the server and try again.', ExitCode.ApiError)
    }
    throw error
  }
}

export const incidentCommand = new Command('incident').alias('incidents').description('Manage AI SRE incidents')

incidentCommand.command('list')
  .description('List incidents')
  .addOption(new Option('--status <status>', 'Filter by incident status (open = not resolved)').choices(['open', 'triggered', 'investigating', 'identified', 'recommendations_ready', 'user_applying_fix', 'verifying', 'resolved']))
  .addOption(new Option('--severity <severity>', 'Filter by severity').choices(['sev1', 'sev2', 'sev3', 'sev4']))
  .option('--assignee <assignee>', 'Filter by assignee: me, unassigned or a user UUID')
  .action(async (options: { status?: string; severity?: string; assignee?: string }) => {
    const { data } = await withSpinner('Fetching incidents', () => createAuthenticatedClient().get<IncidentEnvelope>('/api/sre/incidents', options))
    if (data.truncated) logger.warn('Showing only the most recent incidents; narrow the list with --status, --severity or --assignee.')
    // Older servers have no statusLabel; fall back to the stored status.
    const incidents = data.incidents.map((incident) => ({ ...incident, statusLabel: incident.statusLabel ?? incident.status }))
    output(incidents, { columns: [
      { key: 'incidentNumber', header: '#' }, { key: 'severity', header: 'Severity' },
      { key: 'statusLabel', header: 'Status' }, { key: 'title', header: 'Title' },
      { key: 'primaryServiceName', header: 'Service' }, { key: 'assigneeUserId', header: 'Assignee' },
      { key: 'acknowledgedAt', header: 'Acked' }, { key: 'updatedAt', header: 'Updated' },
    ] })
  })

incidentCommand.command('get <id>').description('Get incident details by number or UUID').action(async (id: string) => {
  id = await resolveIncidentId(id)
  const { data } = await withSpinner('Fetching incident', () => createAuthenticatedClient().get<{ incident: Record<string, unknown> }>(`/api/sre/incidents/${encodeURIComponent(id)}`))
  outputDetail(data.incident)
})

incidentCommand.command('timeline <id>').description('Show the incident timeline by number or UUID').action(async (id: string) => {
  id = await resolveIncidentId(id)
  const { data } = await withSpinner('Fetching incident timeline', () => createAuthenticatedClient().get<{ events: Record<string, unknown>[] }>(`/api/sre/incidents/${encodeURIComponent(id)}/timeline`))
  output(data.events, { columns: [
    { key: 'createdAt', header: 'Time' }, { key: 'eventType', header: 'Event' },
    { key: 'actorType', header: 'Actor' },
    { key: 'eventData', header: 'Details', format: (value, row) => row.eventType === 'notification' ? describeNotificationEvent(value) : value == null ? '-' : JSON.stringify(value) },
  ] })
})

/** Reminder, escalation and failed-page events as one line (ids and types only; the API never returns addresses). */
export function describeNotificationEvent(value: unknown): string {
  const data = (value ?? {}) as { kind?: string; n?: number; of?: number; channels?: { type?: string; ok?: boolean }[]; emailed?: number; reached?: number; preset?: string; status?: number | null; fallback?: string }
  const channels = data.channels ?? []
  const where = [`${channels.filter((c) => c.ok).length}/${channels.length} channel(s)`, data.emailed ? `${data.emailed} email(s)` : ''].filter(Boolean).join(', ')
  switch (data.kind) {
    case 'reminder': return `Reminder ${data.n ?? '?'} of ${data.of ?? '?'} sent to ${where}`
    case 'escalation': return data.reached === 0 ? 'Escalation target was removed; nobody was escalated to' : `Escalated to ${where}`
    case 'page_failed': return `${data.preset ?? 'Paging'} page failed${data.status ? ` (HTTP ${data.status})` : ''}; fallback: ${data.fallback ?? 'none'}`
    default: return JSON.stringify(value)
  }
}

type IncidentPolicy = {
  channelIds: string[]; emailServiceOwnersOnSev12: boolean; autoInvestigateOnOpen: boolean
  renotifyUnackedMinutes: number | null; renotifyRepeatMinutes: number | null; renotifyMax: number
  escalateAfterMinutes: number | null; escalateChannelId: string | null; escalateUserId: string | null
  autoInvestigateEnabledAt?: string | null
}

/** "off" turns a timer off; otherwise whole minutes, 5-1440 (the server validates the schedule as a whole). */
function minutesOrOff(flag: string, value: string): number | null {
  if (value.trim().toLowerCase() === 'off') return null
  const minutes = Number(value)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) throw new CLIError(`${flag} must be off or whole minutes from 5 to 1440`, ExitCode.ConfigError)
  return minutes
}

const policyCommand = incidentCommand.command('policy').description("Read or change the project's incident reminder and escalation policy")

policyCommand.command('get').description("Show the current project's incident policy").action(async () => {
  const { data } = await withSpinner('Fetching incident policy', () => withRouteCheck(() => createAuthenticatedClient().get<{ policy: IncidentPolicy }>('/api/notification-policy')))
  outputDetail(data.policy)
})

policyCommand.command('set')
  .description('Change reminders and escalation; fields you do not pass are kept')
  .option('--first-reminder <minutes|off>', 'Minutes unacknowledged before the first reminder (off disables reminders)')
  .option('--repeat <minutes|off>', 'Minutes between later reminders (off reminds once)')
  .option('--max <count>', 'Total reminders, counting the first (1-10)')
  .option('--escalate-after <minutes|off>', 'Minutes unacknowledged before the one escalation step (off disables it)')
  .option('--escalate-channel <id>', 'Escalate to this channel (not a paging service)')
  .option('--escalate-member <userId>', 'Escalate by email to this project member')
  .action(async (options: { firstReminder?: string; repeat?: string; max?: string; escalateAfter?: string; escalateChannel?: string; escalateMember?: string }) => {
    if (Object.values(options).every((value) => value === undefined)) {
      throw new CLIError('No fields to update. Use --first-reminder, --repeat, --max, --escalate-after, --escalate-channel or --escalate-member.', ExitCode.ConfigError)
    }
    if (options.escalateChannel && options.escalateMember) throw new CLIError('Use --escalate-channel or --escalate-member, not both', ExitCode.ConfigError)
    const max = options.max === undefined ? undefined : Number(options.max)
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 10)) throw new CLIError('--max must be a whole number from 1 to 10', ExitCode.ConfigError)
    const ids = [options.escalateChannel, options.escalateMember].filter((id): id is string => id !== undefined)
    if (ids.some((id) => !z.string().uuid().safeParse(id).success)) throw new CLIError('Escalation targets must be UUIDs', ExitCode.ConfigError)

    const client = createAuthenticatedClient()
    const { data: current } = await withSpinner('Fetching incident policy', () => withRouteCheck(() => client.get<{ policy: IncidentPolicy }>('/api/notification-policy')))
    // The server stamps autoInvestigateEnabledAt itself and rejects it as input.
    const next: IncidentPolicy = { ...current.policy }
    delete next.autoInvestigateEnabledAt
    if (options.firstReminder !== undefined) next.renotifyUnackedMinutes = minutesOrOff('--first-reminder', options.firstReminder)
    if (options.repeat !== undefined) next.renotifyRepeatMinutes = minutesOrOff('--repeat', options.repeat)
    if (max !== undefined) next.renotifyMax = max
    // Turning repeat on over a stored "at most 1" would still remind once.
    if (max === undefined && next.renotifyRepeatMinutes !== null && next.renotifyMax < 2) next.renotifyMax = 3
    if (options.escalateAfter !== undefined) next.escalateAfterMinutes = minutesOrOff('--escalate-after', options.escalateAfter)
    if (options.escalateChannel) Object.assign(next, { escalateChannelId: options.escalateChannel, escalateUserId: null })
    if (options.escalateMember) Object.assign(next, { escalateUserId: options.escalateMember, escalateChannelId: null })
    // Turning reminders off also clears the repeat, which the server rejects without a first reminder.
    if (next.renotifyUnackedMinutes === null) {
      if (options.repeat !== undefined && options.repeat.toLowerCase() !== 'off') {
        throw new CLIError('Set --first-reminder as well: reminders are off, so a repeat would be dropped', ExitCode.ConfigError)
      }
      next.renotifyRepeatMinutes = null
    }
    if (next.escalateAfterMinutes === null) {
      // A target without a delay would be dropped silently; say so instead.
      if (options.escalateChannel || options.escalateMember) {
        throw new CLIError('Set --escalate-after as well: escalation has no delay configured', ExitCode.ConfigError)
      }
      Object.assign(next, { escalateChannelId: null, escalateUserId: null })
    }

    const { data } = await withSpinner('Saving incident policy', () => client.put<{ policy: IncidentPolicy }>('/api/notification-policy', next))
    logger.success('Incident policy saved')
    outputDetail(data.policy)
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
    const { data } = await withSpinner('Resolving incident', () => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${encodeURIComponent(id)}/resolve`, { resolutionSummary: summary, comment: summary }, { retries: 0 }))
    if (data.alreadyResolved === true) logger.info(typeof data.message === 'string' ? data.message : 'Incident was already resolved')
    else logger.success('Incident resolved')
    outputDetail(data)
  })

async function setAssignee(id: string, assigneeUserId: string | null, commander: boolean | undefined): Promise<void> {
  id = await resolveIncidentId(id)
  const role = commander ? 'commander' : 'assignee'
  const { data } = await withSpinner('Updating incident', () => withRouteCheck(() => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${encodeURIComponent(id)}/assign`, { assigneeUserId, role }, { retries: 0 })))
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
    const { data } = await withSpinner('Acknowledging incident', () => withRouteCheck(() => createAuthenticatedClient().post<Record<string, unknown>>(`/api/sre/incidents/${encodeURIComponent(id)}/acknowledge`, {}, { retries: 0 })))
    if (data.alreadyAcknowledged === true) logger.info(typeof data.message === 'string' ? data.message : 'Incident was already acknowledged')
    else logger.success('Incident acknowledged')
    outputDetail(data)
  })

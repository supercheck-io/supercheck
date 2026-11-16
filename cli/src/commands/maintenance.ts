import { Command, Option } from 'commander'
import { z } from 'zod'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, output, outputDetail } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode } from '../utils/errors.js'

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const collect = (value: string, previous: string[] = []) => [...previous, value]
const isUuid = (value: string) => z.string().uuid().safeParse(value).success
const path = (id: string) => `/api/maintenance-windows/${encodeURIComponent(id)}`

/** "90m", "2h", "1h30m" or a bare number of minutes. */
export function parseDuration(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(value.trim())
  if (!match || (!match[1] && !match[2])) throw new CLIError(`"${value}" is not a duration. Use minutes or forms like 90m, 2h, 1h30m.`, ExitCode.ConfigError)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

function requireId(id: string) {
  if (!isUuid(id)) throw new CLIError('Pass the maintenance window UUID (supercheck maintenance list --json).', ExitCode.ConfigError)
  return id
}

function parseStart(value: string) {
  const start = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(value.trim())
  if (!start) throw new CLIError('--start must look like "2026-11-20 02:00".', ExitCode.ConfigError)
  return { startsOn: start[1]!, localStartTime: start[2]! }
}

function parseWeekdays(days?: string) {
  const weekdays = (days ?? '').split(',').map((day) => DAYS.indexOf(day.trim().toLowerCase().slice(0, 3)))
  if (!days || weekdays.some((day) => day < 0)) throw new CLIError('--repeat weekly needs --days, for example mon,thu.', ExitCode.ConfigError)
  return weekdays
}

function parseMonthDay(day?: string) {
  const monthDay = day === 'last' ? -1 : Number(day)
  if (!(monthDay === -1 || (Number.isInteger(monthDay) && monthDay >= 1 && monthDay <= 28))) throw new CLIError('--repeat monthly needs --day 1-28 or --day last.', ExitCode.ConfigError)
  return monthDay
}

const columns = [
  { key: 'title', header: 'Title' }, { key: 'state', header: 'State' }, { key: 'scope', header: 'Scope' },
  { key: 'recurrence', header: 'Repeats' }, { key: 'occurrenceStartsAt', header: 'Starts' }, { key: 'occurrenceEndsAt', header: 'Ends' },
  { key: 'id', header: 'ID' },
]

export const maintenanceCommand = new Command('maintenance').description('Schedule maintenance windows: monitors keep running, alerts, incidents and paging are muted, and uptime leaves the window out')

maintenanceCommand.command('list')
  .description('List maintenance windows')
  .addOption(new Option('--state <state>', 'Filter by state').choices(['active', 'scheduled', 'past']))
  .option('--monitor <id>', 'Only windows that cover this monitor')
  .option('--service <id>', 'Only windows that cover this service')
  .action(async (options: { state?: string; monitor?: string; service?: string }) => {
    if (options.monitor && !isUuid(options.monitor)) throw new CLIError('--monitor takes a monitor UUID.', ExitCode.ConfigError)
    if (options.service && !isUuid(options.service)) throw new CLIError('--service takes a service UUID.', ExitCode.ConfigError)
    const { data } = await withSpinner('Fetching maintenance windows', () => createAuthenticatedClient().get<{ windows: Record<string, unknown>[] }>('/api/maintenance-windows', { ...(options.state ? { state: options.state } : {}), ...(options.monitor ? { monitorId: options.monitor } : {}), ...(options.service ? { serviceId: options.service } : {}) }))
    output(data.windows, { columns })
  })

maintenanceCommand.command('get <id>').description('Show one maintenance window').action(async (id: string) => {
  const { data } = await withSpinner('Fetching maintenance window', () => createAuthenticatedClient().get<{ window: Record<string, unknown> }>(path(requireId(id))))
  outputDetail(data.window)
})

maintenanceCommand.command('create')
  .description('Schedule a maintenance window, for example before a planned deploy')
  .requiredOption('--title <title>', 'Title (max 200 characters)')
  .option('--description <text>', 'What is happening')
  .option('--project', 'Cover every monitor in the project')
  .option('--service <id>', 'Cover the monitors mapped to this service UUID (repeatable)', collect, [])
  .option('--monitor <id>', 'Cover this monitor UUID (repeatable)', collect, [])
  .requiredOption('--start <when>', 'Local start, "YYYY-MM-DD HH:MM" in --timezone')
  .requiredOption('--duration <duration>', 'Length: minutes, or 90m, 2h, 1h30m (5 minutes to 7 days)')
  .option('--timezone <zone>', 'IANA time zone, for example Europe/Berlin', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  .addOption(new Option('--repeat <recurrence>', 'Repeat the window').choices(['daily', 'weekly', 'monthly']))
  .option('--days <days>', 'Weekly: comma-separated days, for example mon,thu')
  .option('--day <day>', 'Monthly: a day from 1 to 28, or "last"')
  .option('--until <date>', 'Last local date an occurrence may start, YYYY-MM-DD')
  .option('--status-page <id>', 'Also post a scheduled maintenance to this status page (one-off only)')
  .option('--component <id>', 'Status page component UUID (repeatable, needs --status-page)', collect, [])
  .option('--notify', 'Notify status page subscribers at creation, start and end')
  .action(async (options: {
    title: string; description?: string; project?: boolean; service: string[]; monitor: string[]; start: string; duration: string; timezone: string
    repeat?: 'daily' | 'weekly' | 'monthly'; days?: string; day?: string; until?: string; statusPage?: string; component: string[]; notify?: boolean
  }) => {
    const scopes = [options.project ? 'project' : null, options.service.length ? 'services' : null, options.monitor.length ? 'monitors' : null].filter(Boolean)
    if (scopes.length !== 1) throw new CLIError('Pick exactly one scope: --project, --service or --monitor.', ExitCode.ConfigError)
    const bad = [...options.service, ...options.monitor, ...options.component, ...(options.statusPage ? [options.statusPage] : [])].find((value) => !isUuid(value))
    if (bad) throw new CLIError(`"${bad}" is not a UUID.`, ExitCode.ConfigError)
    const start = parseStart(options.start)
    if (options.component.length && !options.statusPage) throw new CLIError('--component needs --status-page.', ExitCode.ConfigError)
    if (options.statusPage && !options.component.length) throw new CLIError('--status-page needs at least one --component.', ExitCode.ConfigError)
    if (options.statusPage && options.repeat) throw new CLIError('Only one-off windows can be posted to a status page.', ExitCode.ConfigError)
    let weekdays: number[] | undefined
    if (options.repeat === 'weekly') {
      weekdays = parseWeekdays(options.days)
    }
    let monthDay: number | undefined
    if (options.repeat === 'monthly') {
      monthDay = parseMonthDay(options.day)
    }
    const body = {
      title: options.title,
      ...(options.description ? { description: options.description } : {}),
      scope: scopes[0],
      targets: { serviceIds: options.service, monitorIds: options.monitor },
      recurrence: options.repeat ?? 'once',
      timezone: options.timezone,
      ...start,
      durationMinutes: parseDuration(options.duration),
      ...(options.until ? { endsOn: options.until } : {}),
      ...(weekdays ? { weekdays } : {}),
      ...(monthDay !== undefined ? { monthDay } : {}),
      ...(options.statusPage ? { statusPages: [{ statusPageId: options.statusPage, componentIds: options.component }] } : {}),
      notifySubscribers: options.notify === true,
    }
    const { data } = await withSpinner('Scheduling maintenance', () => createAuthenticatedClient().post<{ window: Record<string, unknown>; warning?: string }>('/api/maintenance-windows', body, { retries: 0 }))
    logger.success('Maintenance window scheduled')
    if (data.warning === 'status_page_failed') logger.warn('The window was created, but posting it to the status page failed.')
    outputDetail(data.window)
  })

maintenanceCommand.command('update <id>')
  .description('Change a maintenance window; only the flags you pass change')
  .option('--title <title>', 'Title (max 200 characters)')
  .option('--description <text>', 'What is happening')
  .option('--project', 'Cover every monitor in the project')
  .option('--service <id>', 'Cover the monitors mapped to this service UUID (repeatable)', collect, [])
  .option('--monitor <id>', 'Cover this monitor UUID (repeatable)', collect, [])
  .option('--start <when>', 'Local start, "YYYY-MM-DD HH:MM" in --timezone')
  .option('--duration <duration>', 'Length: minutes, or 90m, 2h, 1h30m')
  .option('--timezone <zone>', 'IANA time zone, for example Europe/Berlin')
  .addOption(new Option('--repeat <recurrence>', 'Repeat the window').choices(['once', 'daily', 'weekly', 'monthly']))
  .option('--days <days>', 'Weekly: comma-separated days, for example mon,thu')
  .option('--day <day>', 'Monthly: a day from 1 to 28, or "last"')
  .option('--until <date>', 'Last local date an occurrence may start, YYYY-MM-DD')
  .action(async (id: string, options: {
    title?: string; description?: string; project?: boolean; service: string[]; monitor: string[]; start?: string; duration?: string; timezone?: string
    repeat?: 'once' | 'daily' | 'weekly' | 'monthly'; days?: string; day?: string; until?: string
  }) => {
    requireId(id)
    const scopes = [options.project ? 'project' : null, options.service.length ? 'services' : null, options.monitor.length ? 'monitors' : null].filter(Boolean)
    if (scopes.length > 1) throw new CLIError('Pick one scope: --project, --service or --monitor.', ExitCode.ConfigError)
    const bad = [...options.service, ...options.monitor].find((value) => !isUuid(value))
    if (bad) throw new CLIError(`"${bad}" is not a UUID.`, ExitCode.ConfigError)
    const body = {
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(scopes[0] ? { scope: scopes[0], targets: { serviceIds: options.service, monitorIds: options.monitor } } : {}),
      ...(options.start ? parseStart(options.start) : {}),
      ...(options.duration ? { durationMinutes: parseDuration(options.duration) } : {}),
      ...(options.timezone ? { timezone: options.timezone } : {}),
      ...(options.repeat ? { recurrence: options.repeat } : {}),
      ...(options.until ? { endsOn: options.until } : {}),
      ...(options.days ? { weekdays: parseWeekdays(options.days) } : {}),
      ...(options.day ? { monthDay: parseMonthDay(options.day) } : {}),
    }
    if (Object.keys(body).length === 0) throw new CLIError('Pass at least one field to change, for example --title or --duration.', ExitCode.ConfigError)
    const { data } = await withSpinner('Updating maintenance window', () => createAuthenticatedClient().patch<{ window: Record<string, unknown> }>(path(id), body))
    logger.success('Maintenance window updated')
    outputDetail(data.window)
  })

async function lifecycle(id: string, action: 'end' | 'extend' | 'cancel', body: unknown, done: string) {
  const { data } = await withSpinner(`Updating maintenance window`, () => createAuthenticatedClient().post<{ window: Record<string, unknown> }>(`${path(requireId(id))}/${action}`, body, { retries: 0 }))
  logger.success(done)
  outputDetail(data.window)
}

maintenanceCommand.command('end <id>').description('End an active window now; alerts resume at once').action((id: string) => lifecycle(id, 'end', {}, 'Maintenance window ended'))

maintenanceCommand.command('extend <id>')
  .description('Extend an active window')
  .option('--by <duration>', 'How much longer: minutes, or 30m, 1h')
  .option('--until <iso>', 'New end, an ISO 8601 date-time such as 2026-11-20T04:00:00Z')
  .action((id: string, options: { by?: string; until?: string }) => {
    if (Boolean(options.by) === Boolean(options.until)) throw new CLIError('Pass exactly one of --by or --until.', ExitCode.ConfigError)
    if (options.until && Number.isNaN(Date.parse(options.until))) throw new CLIError(`"${options.until}" is not an ISO 8601 date-time.`, ExitCode.ConfigError)
    return lifecycle(id, 'extend', options.by ? { byMinutes: parseDuration(options.by) } : { until: options.until }, 'Maintenance window extended')
  })

maintenanceCommand.command('cancel <id>').description('Cancel a scheduled window, or the rest of a recurring one').action((id: string) => lifecycle(id, 'cancel', {}, 'Maintenance window cancelled'))

maintenanceCommand.command('delete <id>')
  .description('Delete a window that is not active')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    requireId(id)
    if (!options.force) {
      if (!process.stdin.isTTY || getOutputFormat() === 'json') throw new CLIError('Refusing to delete without confirmation in a non-interactive session. Pass --force to proceed.', ExitCode.ConfigError)
      await confirmPrompt(`Delete maintenance window ${id}?`, { default: false })
    }
    await withSpinner('Deleting maintenance window', () => createAuthenticatedClient().delete(path(id)))
    logger.success('Maintenance window deleted')
    outputDetail({ id, deleted: true })
  })

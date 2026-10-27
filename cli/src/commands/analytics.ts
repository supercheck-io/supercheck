import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, output, outputDetail } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { isUuid } from '../utils/paths.js'
import { withSpinner } from '../utils/spinner.js'

export const analyticsCommand = new Command('analytics')
  .description('Show historical job run analytics')

for (const type of ['playwright', 'k6'] as const) {
  const cmd = analyticsCommand
    .command(type)
    .description(`Show ${type} job trends (pass rate, duration, runs per day)`)
    .option('--job <jobId>', 'Filter to one job')
    .option('--period <days>', 'Window in days: 30, 60 or 90', '30')
  if (type === 'k6') {
    cmd.option('--left-run <runId>', 'Compare: baseline run ID').option('--right-run <runId>', 'Compare: candidate run ID')
  }
  cmd.action(async (options: { job?: string; period: string; leftRun?: string; rightRun?: string }) => {
    // The server silently falls back to 30 days and ignores a half-specified comparison, so reject both here.
    if (!['30', '60', '90'].includes(options.period)) throw new CLIError('--period must be 30, 60 or 90.', ExitCode.ConfigError)
    if (Boolean(options.leftRun) !== Boolean(options.rightRun)) throw new CLIError('--left-run and --right-run must be used together.', ExitCode.ConfigError)
    for (const [flag, value] of [['--job', options.job], ['--left-run', options.leftRun], ['--right-run', options.rightRun]] as const) {
      if (value !== undefined && !isUuid(value.toLowerCase())) throw new CLIError(`${flag} must be a UUID.`, ExitCode.ConfigError)
    }
    const { data } = await withSpinner(`Fetching ${type} analytics`, () =>
      createAuthenticatedClient().get<Record<string, unknown>>(`/api/analytics/${type}`, {
        period: options.period,
        jobId: options.job,
        leftRunId: options.leftRun,
        rightRunId: options.rightRun,
      }))
    if (getOutputFormat() !== 'table') return outputDetail(data)
    // Table view: summary fields first, then the trend series as rows (outputDetail would collapse them to counts).
    const series = ['chartData', 'frequencyData'] as const
    outputDetail(Object.fromEntries(Object.entries(data).filter(([key]) => !(series as readonly string[]).includes(key))))
    for (const key of series) {
      const rows = data[key]
      if (Array.isArray(rows) && rows.length > 0) output(rows as Record<string, unknown>[])
    }
  })
}

import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { outputDetail } from '../output/formatter.js'
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
    const { data } = await withSpinner(`Fetching ${type} analytics`, () =>
      createAuthenticatedClient().get<Record<string, unknown>>(`/api/analytics/${type}`, {
        period: options.period,
        jobId: options.job,
        leftRunId: options.leftRun,
        rightRunId: options.rightRun,
      }))
    outputDetail(data)
  })
}

import { Command } from 'commander'
import { discoverRepository } from '../utils/discover.js'
import { outputDetail } from '../output/formatter.js'

export const discoverCommand = new Command('discover')
  .description('Print read-only facts about this repository (framework, tests, routes, CI) for agents')
  .option('--root <directory>', 'Repository root to inspect', '.')
  .action((options: { root: string }) => {
    // Facts only: the agent decides which flows matter. Nothing is executed, imported or uploaded.
    outputDetail(discoverRepository(options.root) as unknown as Record<string, unknown>, { redact: false })
  })

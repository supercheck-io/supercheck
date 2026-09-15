import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import {
  reconcile,
  formatChangePlan,
} from '../utils/reconcile.js'
import { buildLocalResources, fetchRemoteResources } from '../utils/resources.js'
import { withSpinner } from '../utils/spinner.js'


export const diffCommand = new Command('diff')
  .description('Preview changes between local config and the remote Supercheck project')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    const cwd = process.cwd()
    const { config } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient(config.api?.baseUrl)

    logger.newline()

    const { localResources, remoteResources } = await withSpinner(
      'Comparing local and remote resources...',
      async () => {
        const local = buildLocalResources(config, cwd)
        const remote = await fetchRemoteResources(client)
        return { localResources: local, remoteResources: remote }
      },
      { successText: 'Resources compared' },
    )

    logger.debug(`Local: ${localResources.length} resources, Remote: ${remoteResources.length} resources`)

    const changes = reconcile(localResources, remoteResources)
    formatChangePlan(changes)
  })

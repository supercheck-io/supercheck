import { verifyContext, describeTarget, managedState } from '../utils/managed.js'
import { getOutputFormat } from '../output/formatter.js'
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
  .option('--delete', 'Delete ALL remote resources absent from config (including resources created elsewhere)', false)
  .action(async (options: { config?: string; delete?: boolean }) => {
    const cwd = process.cwd()
    const { config, configPath, declaredBaseUrl } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient(config.api?.baseUrl)

    const context = await verifyContext(client, config, false, declaredBaseUrl)
    logger.info(`Target: ${describeTarget(context)}`)
  const state = managedState(client, context, configPath)
  logger.newline()

    const { localResources, remoteResources } = await withSpinner(
      'Comparing local and remote resources...',
      async () => {
        const local = state.resolveTests(state.apply(buildLocalResources(config, cwd)))
        const remote = await fetchRemoteResources(client)
        return { localResources: local, remoteResources: remote }
      },
      { successText: 'Resources compared' },
    )

    logger.debug(`Local: ${localResources.length} resources, Remote: ${remoteResources.length} resources`)

    const changes = reconcile(localResources, remoteResources).filter((change) => options.delete === true || change.action !== 'delete')
    if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: 'preview', context, hasChanges: changes.some((change) => change.action !== 'no-change'), summary: changes.reduce<Record<string, number>>((acc, change) => ({ ...acc, [change.action]: (acc[change.action] ?? 0) + 1 }), {}), changes: changes.map(({ action, type, id, name, details }) => ({ action, type, id, name, details })) }))
  else formatChangePlan(changes)
  })

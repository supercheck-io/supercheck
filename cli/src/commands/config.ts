import { Command } from 'commander'
import { loadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import { output } from '../output/formatter.js'

export const configCommand = new Command('config')
  .description('Configuration management')

configCommand
  .command('validate')
  .description('Validate supercheck.config.ts')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    const { config, configPath } = await loadConfig({ configPath: options.config })
    logger.success(`Valid configuration loaded from ${configPath}`)
    logger.info(`  Organization: ${config.project.organization}`)
    logger.info(`  Project:      ${config.project.project}`)
  })
function redactSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
  if (Array.isArray(cloned.variables)) {
    for (const v of cloned.variables as Array<Record<string, unknown>>) {
      if (v && typeof v === 'object' && (v.isSecret || v.type === 'secret')) {
        v.value = '********'
      }
    }
  }
  return cloned
}

configCommand
  .command('print')
  .description('Print the resolved configuration')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    const { config } = await loadConfig({ configPath: options.config })
    output(redactSecrets(config as unknown as Record<string, unknown>))
  })

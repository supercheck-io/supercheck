import { redact } from '../utils/redact.js'
import { Command } from 'commander'
import { loadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output } from '../output/formatter.js'

export const configCommand = new Command('config')
  .description('Configuration management')

configCommand
  .command('validate')
  .description('Validate supercheck.config.ts')
  .option('--offline', 'Validate local-only configuration without cloud project identity')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string; offline?: boolean }) => {
    const { config, configPath } = await loadConfig({ configPath: options.config, offline: options.offline })
    if (getOutputFormat() === 'json') logger.output(JSON.stringify({ valid: true, configPath, project: config.project }))
    logger.success(`Valid configuration loaded from ${configPath}`)
    logger.info(`  Organization: ${config.project.organization}`)
    logger.info(`  Project:      ${config.project.project}`)
  })

configCommand
  .command('print')
  .description('Print the resolved configuration')
  .option('--offline', 'Validate local-only configuration without cloud project identity')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string; offline?: boolean }) => {
    const { config } = await loadConfig({ configPath: options.config, offline: options.offline })
    const redacted = redact(config as unknown as Record<string, unknown>)
    if (getOutputFormat() === 'table') logger.output(JSON.stringify(redacted, null, 2))
    else output(redacted)
  })

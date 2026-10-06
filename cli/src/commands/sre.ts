import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, outputDetail } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { postSse } from '../utils/sse.js'
import { withSpinner } from '../utils/spinner.js'
import { resolveIncidentId } from '../utils/incidents.js'

export const sreCommand = new Command('sre').description('AI-assisted incident investigation')

sreCommand.command('triage <incidentId>').description('Classify an incident by number or UUID').action(async (incidentId: string) => {
  incidentId = await resolveIncidentId(incidentId)
  const { data } = await withSpinner('Triaging incident', () => createAuthenticatedClient().post<Record<string, unknown>>('/api/sre/triage', { incidentId }))
  outputDetail(data)
})

sreCommand.command('investigate <incidentId>')
  .description('Start a deep incident investigation by number or UUID')
  .option('--live-connectors', 'Allow configured read-only telemetry connectors')
  .action(async (incidentId: string, options: { liveConnectors?: boolean }) => {
    incidentId = await resolveIncidentId(incidentId)
    const { data } = await withSpinner('Starting investigation', () => createAuthenticatedClient().post<Record<string, unknown>>('/api/sre/investigate', {
      incidentId,
      useLiveConnectors: Boolean(options.liveConnectors),
    }))
    outputDetail(data)
  })

sreCommand.command('ask <question>')
  .description('Ask Copilot a read-only reliability question')
  .option('--incident <incidentId>', 'Scope the conversation to an incident number or UUID')
  .option('--live-connectors', 'Allow configured read-only telemetry connectors')
  .option('--idle-timeout <seconds>', 'Abort when no stream data arrives', '60')
  .action(async (question: string, options: { incident?: string; liveConnectors?: boolean; idleTimeout: string }) => {
    const json = getOutputFormat() === 'json'
    await postSse('/api/sre/chat', {
      message: question,
      incidentId: options.incident ? await resolveIncidentId(options.incident) : null,
      useLiveConnectorTools: Boolean(options.liveConnectors),
    }, ({ event, data }) => {
      if (json) {
        logger.output(JSON.stringify({ event, data }))
        return
      }
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (event === 'message' && record.role === 'assistant' && typeof record.content === 'string') logger.output(record.content)
      else if (event === 'agent.step') logger.info(`Investigation step ${String(record.stepIndex ?? '')}`.trim())
    }, Math.max(Number(options.idleTimeout) || 60, 10) * 1000)
  })

sreCommand.command('brief <incidentId>')
  .description('Generate and stream an evidence brief by incident number or UUID')
  .option('--idle-timeout <seconds>', 'Abort when no stream data arrives', '60')
  .action(async (incidentId: string, options: { idleTimeout: string }) => {
    incidentId = await resolveIncidentId(incidentId)
    const json = getOutputFormat() === 'json'
    await postSse('/api/sre/evidence-brief/stream', { incidentId }, ({ event, data }) => {
      if (json) {
        logger.output(JSON.stringify({ event, data }))
        return
      }
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (record.type === 'content' && typeof record.content === 'string') process.stdout.write(record.content)
      else if (record.type === 'done') {
        logger.newline()
        logger.success(String(record.message ?? 'Evidence brief generated'))
      }
    }, Math.max(Number(options.idleTimeout) || 60, 10) * 1000)
  })

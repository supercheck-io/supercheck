import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getOutputFormat, outputDetail, outputNarrative } from '../output/formatter.js'
import { logger } from '../utils/logger.js'
import { postSse } from '../utils/sse.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { z } from 'zod'
import { resolveIncidentId } from '../utils/incidents.js'

// Triage is synchronous server-side (up to ~45s budget); leave headroom over the 30s client default.
const TRIAGE_TIMEOUT_MS = 90_000
const MIN_IDLE_TIMEOUT_SECONDS = 10

function parseIdleTimeout(value: string): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < MIN_IDLE_TIMEOUT_SECONDS) {
    throw new CLIError(`--idle-timeout must be a number of seconds >= ${MIN_IDLE_TIMEOUT_SECONDS}.`, ExitCode.ConfigError)
  }
  return seconds * 1000
}

export const sreCommand = new Command('sre').description('AI-assisted incident investigation')

sreCommand.command('triage <incidentId>').description('Classify an incident by number or UUID').action(async (incidentId: string) => {
  incidentId = await resolveIncidentId(incidentId)
  const { data } = await withSpinner('Triaging incident', () => createAuthenticatedClient().post<Record<string, unknown>>('/api/sre/triage', { incidentId }, { timeout: TRIAGE_TIMEOUT_MS, retries: 0 }))
  if (getOutputFormat() === 'json') outputDetail(data)
  else {
    outputDetail({ id: data.investigationRunId, status: 'completed', model: data.modelId, finishReason: data.finishReason })
    if (typeof data.summary === 'string') outputNarrative('Triage summary', data.summary)
  }
})

sreCommand.command('investigate <incidentId>')
  .description('Start a deep incident investigation by number or UUID')
  .option('--live-connectors', 'Allow configured read-only telemetry connectors')
  .action(async (incidentId: string, options: { liveConnectors?: boolean }) => {
    incidentId = await resolveIncidentId(incidentId)
    const { data } = await withSpinner('Starting investigation', () => createAuthenticatedClient().post<Record<string, unknown>>('/api/sre/investigate', {
      incidentId,
      useLiveConnectors: Boolean(options.liveConnectors),
    }, { retries: 0 }))
    if (getOutputFormat() === 'json') outputDetail(data)
    else {
      outputDetail({ id: data.investigationRunId, incidentId, status: 'accepted' })
      if (getOutputFormat() === 'table' && typeof data.investigationRunId === 'string') logger.info(`Follow with: supercheck sre status ${data.investigationRunId}`)
    }
  })

sreCommand.command('ask <question>')
  .description('Ask Copilot a read-only reliability question')
  .option('--incident <incidentId>', 'Scope the conversation to an incident number or UUID')
  .option('--live-connectors', 'Allow configured read-only telemetry connectors')
  .option('--idle-timeout <seconds>', 'Abort when no stream data arrives', '60')
  .action(async (question: string, options: { incident?: string; liveConnectors?: boolean; idleTimeout: string }) => {
    const idleTimeoutMs = parseIdleTimeout(options.idleTimeout)
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
      if (event === 'message' && record.role === 'assistant' && typeof record.content === 'string') outputNarrative('Copilot', record.content)
      else if (event === 'agent.step') logger.info(`Investigation step ${String(record.stepIndex ?? '')}`.trim())
    }, { idleTimeoutMs, isTerminal: ({ event }) => event === 'done' })
  })

sreCommand.command('brief <incidentId>')
  .description('Generate and stream an evidence brief by incident number or UUID')
  .option('--idle-timeout <seconds>', 'Abort when no stream data arrives', '60')
  .action(async (incidentId: string, options: { idleTimeout: string }) => {
    const idleTimeoutMs = parseIdleTimeout(options.idleTimeout)
    incidentId = await resolveIncidentId(incidentId)
    const json = getOutputFormat() === 'json'
    let hasContent = false
    await postSse('/api/sre/evidence-brief/stream', { incidentId }, ({ event, data }) => {
      if (json) {
        logger.output(JSON.stringify({ event, data }))
        return
      }
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (record.type === 'content' && typeof record.content === 'string' && getOutputFormat() === 'table') {
        if (!hasContent) { logger.output('\nEvidence brief\n'); hasContent = true }
        process.stdout.write(record.content)
      }
      else if (record.type === 'done') {
        if (hasContent) process.stdout.write('\n')
        logger.newline()
        logger.success(String(record.message ?? 'Evidence brief generated'))
      }
    }, {
      idleTimeoutMs,
      isTerminal: ({ data }) => typeof data === 'object' && data !== null && (data as Record<string, unknown>).type === 'done',
    })
  })

sreCommand.command('status <runId>')
  .description('Get the status of a triage or investigation run')
  .action(async (runId: string) => {
    if (!z.string().uuid().safeParse(runId).success) throw new CLIError('Investigation run ID must be a UUID.', ExitCode.ConfigError)
    const { data } = await withSpinner('Fetching investigation status', () => createAuthenticatedClient().get<{ run: Record<string, unknown> }>(`/api/sre/runs/${runId}`))
    outputDetail(data.run)
  })

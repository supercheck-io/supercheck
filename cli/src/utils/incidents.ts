import { z } from 'zod'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { CLIError, ExitCode } from './errors.js'

/** Resolve the displayed incident number within the token's project. */
export async function resolveIncidentId(reference: string): Promise<string> {
  if (z.string().uuid().safeParse(reference).success) return reference
  if (!/^[1-9]\d*$/.test(reference) || !Number.isSafeInteger(Number(reference))) {
    throw new CLIError('Use an incident number or UUID from `supercheck incident list`.', ExitCode.ConfigError)
  }
  const { data } = await createAuthenticatedClient().get<{
    incidents: Array<{ id: string; incidentNumber: number }>
  }>('/api/sre/incidents', { incidentNumber: reference })
  const incident = data.incidents.find((item) => item.incidentNumber === Number(reference))
  if (!incident || !z.string().uuid().safeParse(incident.id).success) {
    throw new CLIError(`Incident #${reference} was not found in this project. Try its UUID from supercheck incident list --json.`, ExitCode.ApiError)
  }
  return incident.id
}

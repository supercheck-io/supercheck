import { z } from 'zod'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { CLIError, ExitCode } from './errors.js'

/** Server-side incidentNumber is a 32-bit integer. */
const MAX_INCIDENT_NUMBER = 2_147_483_647

/** Resolve the displayed incident number within the token's project. */
export async function resolveIncidentId(reference: string): Promise<string> {
  if (z.string().uuid().safeParse(reference).success) return reference
  if (!/^[1-9]\d*$/.test(reference) || Number(reference) > MAX_INCIDENT_NUMBER) {
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

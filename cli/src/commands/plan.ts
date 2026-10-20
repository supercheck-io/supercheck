import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import type { ApiClient } from '../api/client.js'
import { outputDetail } from '../output/formatter.js'
import { ApiRequestError } from '../utils/errors.js'

interface SubscriptionStatus {
  organizationId?: string
  isActive?: boolean
  plan?: string | null
  status?: string | null
  reason?: string | null
  subscriptionEndsAt?: string | null
}

/** Plan visibility for agents. `unknown` is never treated as a free or paid plan. */
export async function readPlan(client: Pick<ApiClient, 'get'> = createAuthenticatedClient()): Promise<Record<string, unknown>> {
  try {
    const { data } = await client.get<SubscriptionStatus>('/api/subscription/status')
    return {
      state: data.isActive === true ? 'active' : data.isActive === false ? 'inactive' : 'unknown',
      plan: data.plan ?? null,
      status: data.status ?? null,
      reason: data.reason ?? null,
      subscriptionEndsAt: data.subscriptionEndsAt ?? null,
      note: 'Local authoring and offline test runs never require a plan. Cloud deploy and execution are enforced by the server on each request.',
      ...(data.isActive === false ? { action: 'A person must choose a plan in the dashboard billing page; API keys cannot purchase a plan.' } : {}),
    }
  } catch (error) {
    if (error instanceof ApiRequestError && [404, 405].includes(error.statusCode ?? 0)) {
      return { state: 'unknown', note: 'This server does not expose subscription status. Server-side enforcement still applies.' }
    }
    throw error
  }
}

export const planCommand = new Command('plan')
  .description('Show the subscription state for the current project\'s organization')
  .action(async () => outputDetail(await readPlan()))

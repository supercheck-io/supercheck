import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DB_PROVIDER_TOKEN } from '../db/db.constants';
import type * as schema from '../db/schema';
import {
  BILLING_NOT_CONFIGURED,
  BILLING_VERIFICATION_FAILED,
  UsageTrackerService,
} from '../execution/services/usage-tracker.service';

/** Billing could not be checked (transient error or missing configuration): retry, do not decide. */
export class BillingVerificationError extends Error {}

type Database = PostgresJsDatabase<typeof schema>;

/**
 * Billing-hold check for cycle closure. UsageTrackerService starts an unrelated usage-recovery
 * timer in onModuleInit, so it is constructed by hand (per call, on the caller's transaction) and
 * is NOT a Nest provider: the framework never sees it and never runs its lifecycle hooks here.
 */
@Injectable()
export class BillingHoldService {
  constructor(@Inject(DB_PROVIDER_TOKEN) private readonly db: Database) {}

  /**
   * True when the organization is genuinely held. A held monitor must never turn into false
   * missing-region downtime. A failed or impossible verification throws instead, so the cycle stays
   * open and is retried rather than being closed (or aborted) on a guess.
   */
  async isHeld(
    organizationId: string | null,
    monitor: { id: string; type: string },
    database: Database = this.db,
  ): Promise<{ blocked: boolean; reason?: string }> {
    const result = await new UsageTrackerService(database).shouldBlockExecution(
      organizationId ?? '',
      {
        checkSpendingLimit: monitor.type === 'synthetic_test',
        monitorId: monitor.id,
      },
    );
    if (
      result.blocked &&
      (result.reason?.startsWith(BILLING_VERIFICATION_FAILED) ||
        result.reason === BILLING_NOT_CONFIGURED)
    ) {
      throw new BillingVerificationError(result.reason);
    }
    return result;
  }
}

/** Cloud mode needs the same billing credentials as the worker; self-hosted never checks billing. */
export function controlPlaneConfigProblem(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const selfHosted = ['true', '1'].includes(
    env.SELF_HOSTED?.trim().toLowerCase() ?? '',
  );
  if (!selfHosted && !env.POLAR_ACCESS_TOKEN) {
    return 'POLAR_ACCESS_TOKEN is required in cloud mode (same billing configuration as the worker)';
  }
  return null;
}

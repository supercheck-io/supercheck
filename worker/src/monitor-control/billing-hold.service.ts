import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DB_PROVIDER_TOKEN } from '../db/db.constants';
import type * as schema from '../db/schema';
import { UsageTrackerService } from '../execution/services/usage-tracker.service';

/**
 * Billing-hold check for cycle closure. UsageTrackerService starts an unrelated usage-recovery
 * timer in onModuleInit, so it is constructed by hand and is NOT a Nest provider: the framework
 * never sees it and never runs its lifecycle hooks in the control-plane process.
 */
@Injectable()
export class BillingHoldService {
  private readonly usage: Pick<UsageTrackerService, 'shouldBlockExecution'>;

  constructor(
    @Inject(DB_PROVIDER_TOKEN) db: PostgresJsDatabase<typeof schema>,
  ) {
    this.usage = new UsageTrackerService(db);
  }

  /** A held monitor must never turn into false missing-region downtime. */
  isHeld(
    organizationId: string | null,
    monitor: { id: string; type: string },
  ): Promise<{ blocked: boolean; reason?: string }> {
    return this.usage.shouldBlockExecution(organizationId ?? '', {
      checkSpendingLimit: monitor.type === 'synthetic_test',
      monitorId: monitor.id,
    });
  }
}

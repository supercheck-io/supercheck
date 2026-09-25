import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '../../db/schema';

type Database = PostgresJsDatabase<typeof schema>;
export type ExecutionUsageTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface ExecutionUsageCompletion {
  organizationId: string;
  runId: string;
  eventType: 'playwright_execution' | 'k6_execution';
  durationMs: number;
  virtualUsers?: number;
  metadata?: Record<string, unknown>;
}

export function executionUsageUnits(input: ExecutionUsageCompletion): number {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error('Invalid execution duration');
  }
  if (input.eventType === 'playwright_execution') {
    return Math.round((input.durationMs / 60_000) * 10_000) / 10_000;
  }
  if (!Number.isFinite(input.virtualUsers) || input.virtualUsers! < 0) {
    throw new Error('Invalid K6 virtual user count');
  }
  return Math.ceil(input.virtualUsers! * (input.durationMs / 60_000));
}

/** Receipt and terminal result commit together; never infer charges from old runs. */
export async function persistExecutionReceipt(
  db: Database,
  input: ExecutionUsageCompletion,
  persistResult: (tx: ExecutionUsageTransaction) => Promise<void>,
): Promise<string> {
  const units = executionUsageUnits(input);
  if (!Number.isFinite(units) || units >= 1_000_000) {
    throw new Error('Execution usage exceeds ledger precision');
  }
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, input.organizationId))
      .for('update');
    if (!org) throw new Error('Billing organization not found');

    const existing = await tx.query.executionUsageReceipts.findFirst({
      where: and(
        eq(schema.executionUsageReceipts.organizationId, input.organizationId),
        eq(schema.executionUsageReceipts.eventType, input.eventType),
        eq(schema.executionUsageReceipts.runId, input.runId),
      ),
    });
    const id = existing?.id ?? uuidv7();
    if (!existing) {
      const now = new Date();
      await tx.insert(schema.executionUsageReceipts).values({
        id,
        organizationId: input.organizationId,
        runId: input.runId,
        eventType: input.eventType,
        units: String(units),
        metadata: { ...input.metadata, runId: input.runId },
        billingPeriodStart: org.usagePeriodStart ?? now,
        billingPeriodEnd:
          org.usagePeriodEnd ??
          new Date(now.getFullYear(), now.getMonth() + 1, 1),
        createdAt: now,
        nextAttemptAt: now,
      });
    }
    await persistResult(tx);
    return id;
  });
}

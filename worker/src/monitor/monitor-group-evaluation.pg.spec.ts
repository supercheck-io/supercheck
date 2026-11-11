/**
 * Real-PostgreSQL tests for the legacy group alert receipt (monitor_group_evaluations). Skipped unless
 * MONITOR_CYCLE_TEST_DATABASE_URL is set (CI sets it). Exactly-once under concurrent preparers and the
 * jsonb receipt reads cannot be proven with a mock.
 */
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import { MonitorEvaluator } from './monitor-evaluator';
import {
  createTestDatabase,
  seedMonitor,
} from '../monitor-control/pg-test-database';

jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('MonitorEvaluator group receipt (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let evaluator: MonitorEvaluator;
  let monitorId: string;
  // Recent: the evaluator refuses groups older than GROUP_EVALUATION_MAX_AGE_MS.
  const checkedAt = new Date(Date.now() - 60_000);

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    ({ client, db } = testDb);
    evaluator = new MonitorEvaluator(
      { db } as unknown as DbService,
      {} as never,
    );
  });

  afterAll(async () => {
    if (testDb) await testDb.drop();
  });

  beforeEach(async () => {
    ({ monitorId } = await seedMonitor(db, client));
    // Two regions, so the evaluation carries aggregated alert counters.
    await db
      .update(schema.monitors)
      .set({
        config: {
          locationConfig: {
            enabled: true,
            locations: ['eu', 'us'],
            strategy: 'all',
          },
        } as never,
      })
      .where(eq(schema.monitors.id, monitorId));
  });

  async function report(group: string, details?: Record<string, unknown>) {
    for (const location of ['eu', 'us']) {
      await db.insert(schema.monitorResults).values({
        monitorId,
        location,
        checkedAt,
        status: 'down',
        isUp: false,
        executionGroupId: group,
        details: { responseBody: 'body', ...(details ?? {}) } as never,
      });
    }
  }

  const receiptRows = (group: string) =>
    db
      .select()
      .from(schema.monitorGroupEvaluations)
      .where(
        and(
          eq(schema.monitorGroupEvaluations.monitorId, monitorId),
          eq(schema.monitorGroupEvaluations.executionGroupId, group),
        ),
      );

  const resultDetails = async (group: string) =>
    (
      await db
        .select({ details: schema.monitorResults.details })
        .from(schema.monitorResults)
        .where(eq(schema.monitorResults.executionGroupId, group))
    ).map((row) => row.details);

  const failureCount = async () => {
    const [monitor] = await db
      .select({ config: schema.monitors.config })
      .from(schema.monitors)
      .where(eq(schema.monitors.id, monitorId));
    return (
      monitor.config as {
        aggregatedAlertState?: { consecutiveFailureCount: number };
      }
    ).aggregatedAlertState?.consecutiveFailureCount;
  };

  it('writes one receipt and leaves result rows untouched', async () => {
    await report('g1');
    const before = await resultDetails('g1');
    const prepared = await evaluator.prepareGroupEvaluation(
      monitorId,
      'g1',
      'down',
      checkedAt,
      2,
    );
    expect(prepared).toMatchObject({
      receipt: { kind: 'group' },
      evaluation: { previousStatus: 'up', currentStatus: 'down' },
    });
    const [receipt] = await receiptRows('g1');
    expect(receipt).toMatchObject({
      evaluation: { previousStatus: 'up', currentStatus: 'down' },
      notificationProcessedAt: null,
    });
    expect(await resultDetails('g1')).toEqual(before);
    expect(await failureCount()).toBe(1);
  });

  it('advances counters once when many workers prepare the same group concurrently', async () => {
    await report('race');
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        evaluator.prepareGroupEvaluation(
          monitorId,
          'race',
          'down',
          checkedAt,
          2,
        ),
      ),
    );
    expect(await receiptRows('race')).toHaveLength(1);
    expect(await failureCount()).toBe(1);
    // Every preparer acts on the one committed decision (jsonb may reorder keys, so compare deeply).
    for (const outcome of outcomes)
      expect(outcome!.evaluation).toEqual(outcomes[0]!.evaluation);
  });

  it('resumes after a crash before notifying, then stops once notified', async () => {
    await report('crash');
    const first = await evaluator.prepareGroupEvaluation(
      monitorId,
      'crash',
      'down',
      checkedAt,
      2,
    );
    // The worker died here: alerts were not handled. A retry resumes the same decision.
    const retry = await evaluator.prepareGroupEvaluation(
      monitorId,
      'crash',
      'down',
      checkedAt,
      2,
    );
    expect(retry!.evaluation).toEqual(first!.evaluation);
    expect(await failureCount()).toBe(1);
    await evaluator.markGroupNotified(monitorId, 'crash', retry!.receipt);
    const [receipt] = await receiptRows('crash');
    expect(receipt.notificationProcessedAt).toBeInstanceOf(Date);
    await evaluator.markGroupNotified(monitorId, 'crash', retry!.receipt);
    expect((await receiptRows('crash'))[0].notificationProcessedAt).toEqual(
      receipt.notificationProcessedAt,
    );
    await expect(
      evaluator.prepareGroupEvaluation(
        monitorId,
        'crash',
        'down',
        checkedAt,
        2,
      ),
    ).resolves.toBeNull();
    expect(await failureCount()).toBe(1);
  });

  it('honours a receipt an older worker wrote into a result row', async () => {
    await report('old', {
      aggregationEvaluation: {
        previousStatus: 'up',
        currentStatus: 'down',
        alertState: { consecutiveFailureCount: 7 },
      },
      aggregationNotificationProcessed: false,
    });
    const prepared = await evaluator.prepareGroupEvaluation(
      monitorId,
      'old',
      'up',
      checkedAt,
      2,
    );
    expect(prepared).toMatchObject({
      receipt: { kind: 'legacy' },
      evaluation: { alertState: { consecutiveFailureCount: 7 } },
    });
    expect(await receiptRows('old')).toHaveLength(0);
    expect(await failureCount()).toBeUndefined();
    await evaluator.markGroupNotified(monitorId, 'old', prepared!.receipt);
    const details = await resultDetails('old');
    expect(
      details.filter(
        (d) =>
          (d as Record<string, unknown>).aggregationNotificationProcessed ===
          true,
      ),
    ).toHaveLength(1);
    await expect(
      evaluator.prepareGroupEvaluation(monitorId, 'old', 'up', checkedAt, 2),
    ).resolves.toBeNull();
  });

  it('stops at a legacy receipt an older worker already marked processed', async () => {
    await report('old-done', {
      aggregationEvaluation: { previousStatus: 'up', currentStatus: 'down' },
      aggregationNotificationProcessed: true,
    });
    await expect(
      evaluator.prepareGroupEvaluation(
        monitorId,
        'old-done',
        'down',
        checkedAt,
        2,
      ),
    ).resolves.toBeNull();
    expect(await receiptRows('old-done')).toHaveLength(0);
    expect(await failureCount()).toBeUndefined();
  });

  it('ignores a legacy key that is not an evaluation object and treats odd flags as unprocessed', async () => {
    // JSON null under the key is not a receipt: the group is evaluated normally.
    await report('nullish', { aggregationEvaluation: null });
    const fresh = await evaluator.prepareGroupEvaluation(
      monitorId,
      'nullish',
      'down',
      checkedAt,
      2,
    );
    expect(fresh!.receipt).toEqual({ kind: 'group' });
    // A string flag never fails the job; only JSON true counts as processed.
    await report('odd', {
      aggregationEvaluation: { previousStatus: 'down', currentStatus: 'down' },
      aggregationNotificationProcessed: 'yes',
    });
    const odd = await evaluator.prepareGroupEvaluation(
      monitorId,
      'odd',
      'down',
      checkedAt,
      2,
    );
    expect(odd!.receipt).toMatchObject({ kind: 'legacy' });
  });

  it('marks nothing and does not throw when the monitor was deleted after preparing', async () => {
    await report('gone');
    const prepared = await evaluator.prepareGroupEvaluation(
      monitorId,
      'gone',
      'down',
      checkedAt,
      2,
    );
    await db.delete(schema.monitors).where(eq(schema.monitors.id, monitorId));
    await expect(
      evaluator.markGroupNotified(monitorId, 'gone', prepared!.receipt),
    ).resolves.toBeUndefined();
    expect(await receiptRows('gone')).toHaveLength(0);
  });

  it('refuses a group with no persisted results and writes nothing', async () => {
    await expect(
      evaluator.prepareGroupEvaluation(monitorId, 'none', 'down', checkedAt, 2),
    ).rejects.toThrow('Persisted aggregation group is missing');
    expect(await receiptRows('none')).toHaveLength(0);
    expect(await failureCount()).toBeUndefined();
  });

  it('enforces one receipt per group and cascades with its monitor', async () => {
    await report('pk');
    await evaluator.prepareGroupEvaluation(
      monitorId,
      'pk',
      'down',
      checkedAt,
      2,
    );
    await expect(
      db.insert(schema.monitorGroupEvaluations).values({
        monitorId,
        executionGroupId: 'pk',
        evaluation: {},
      }),
    ).rejects.toThrow();
    await db.delete(schema.monitors).where(eq(schema.monitors.id, monitorId));
    expect(await receiptRows('pk')).toHaveLength(0);
  });

  it('rejects a receipt for a monitor that does not exist', async () => {
    await expect(
      db.insert(schema.monitorGroupEvaluations).values({
        monitorId: '00000000-0000-7000-8000-000000000000',
        executionGroupId: 'orphan',
        evaluation: {},
      }),
    ).rejects.toThrow();
  });
});

/** Real-PostgreSQL tests for the polling processor. Skipped without MONITOR_CYCLE_TEST_DATABASE_URL. */

import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import type { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { MonitorCycleProcessor } from './monitor-cycle.processor';
import { BillingVerificationError } from './billing-hold.service';
import { MonitorCycleService } from './monitor-cycle.service';
import type { BillingHoldService } from './billing-hold.service';
import { createTestDatabase, seedMonitor } from './pg-test-database';

jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('MonitorCycleProcessor (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let processor: MonitorCycleProcessor;
  let monitorId: string;
  const sendNotification = jest.fn().mockResolvedValue({ successful: 1 });
  const alertService = {
    sendNotification,
    sendSslExpirationNotification: jest.fn(),
  } as unknown as MonitorAlertService;
  const billing = {
    isHeld: jest.fn().mockResolvedValue({ blocked: false }),
  } as unknown as BillingHoldService;

  const t0 = new Date('2026-10-21T10:00:00Z');
  const deadline = new Date('2026-10-21T10:05:00Z');

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    ({ client, db } = testDb);
    const dbService = { db } as unknown as DbService;
    processor = new MonitorCycleProcessor(
      dbService,
      new MonitorCycleService(dbService, alertService, billing),
    );
  });
  afterAll(async () => {
    if (testDb) await testDb.drop();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    ({ monitorId } = await seedMonitor(db, client));
  });

  const open = (id: string, strategy: 'all' | 'any' | 'majority' = 'all') =>
    db.insert(schema.monitorCycles).values({
      id,
      monitorId,
      scheduledFor: t0,
      deadlineAt: deadline,
      expectedLocations: ['eu', 'us'],
      strategy,
      threshold: 50,
    });
  const report = (id: string, location: string, isUp = true) =>
    db.insert(schema.monitorResults).values({
      monitorId,
      location,
      checkedAt: new Date(t0.getTime() + 1000),
      status: isUp ? 'up' : 'down',
      isUp,
      executionGroupId: id,
    });
  const hint = (cycleId: string, location: string) =>
    db.insert(schema.monitorCycleArrivals).values({ cycleId, location });
  const cycle = async (id: string) =>
    (
      await db
        .select()
        .from(schema.monitorCycles)
        .where(eq(schema.monitorCycles.id, id))
    )[0];

  it('closes a decisive cycle from an arrival hint without waiting for the deadline, and notifies once', async () => {
    await open('p1', 'any');
    await report('p1', 'eu');
    await hint('p1', 'eu');
    await processor.tick(new Date(t0.getTime() + 5000));
    expect(await cycle('p1')).toMatchObject({
      status: 'closed',
      closedBy: 'arrival',
      resultStatus: 'up',
    });
    expect((await cycle('p1')).notifiedAt).not.toBeNull();
    const [arrival] =
      await client`SELECT processed_at FROM monitor_cycle_arrivals WHERE cycle_id = 'p1'`;
    expect(arrival.processed_at).not.toBeNull();
    // Recovery from up->up sends nothing; status stays up.
    expect((await db.select().from(schema.monitors))[0].status).toBe('up');
  });

  it('leaves an undecided cycle open and closes it at the deadline even when every hint was lost', async () => {
    await open('p2');
    await report('p2', 'eu');
    await processor.tick(new Date(t0.getTime() + 10_000));
    expect((await cycle('p2')).status).toBe('open');
    await processor.tick(new Date(deadline.getTime() + 1000));
    expect(await cycle('p2')).toMatchObject({
      status: 'closed',
      closedBy: 'deadline',
      resultStatus: 'down',
      missingLocations: ['us'],
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('closes an all-offline cycle with no results and no hints at the deadline', async () => {
    await open('p3');
    await processor.tick(new Date(deadline.getTime() + 1000));
    expect(await cycle('p3')).toMatchObject({
      status: 'closed',
      observedLocations: [],
      missingLocations: ['eu', 'us'],
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('keeps a hint re-armed after it was claimed, so the retried result is evaluated next tick', async () => {
    await open('p4');
    await report('p4', 'eu', false);
    await hint('p4', 'eu');
    await processor.tick(new Date(t0.getTime() + 2000));
    expect((await cycle('p4')).status).toBe('closed'); // all strategy: one down is decisive
    // A later retry upserts the hint again; it must be pending, not erased.
    await client`UPDATE monitor_cycle_arrivals SET processed_at = NULL WHERE cycle_id = 'p4'`;
    const [pending] =
      await client`SELECT count(*)::int AS n FROM monitor_cycle_arrivals WHERE processed_at IS NULL`;
    expect(pending.n).toBe(1);
    await processor.tick(new Date(t0.getTime() + 4000));
    expect(await cycle('p4')).toMatchObject({ status: 'closed' });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('repairs a closed cycle whose notification step crashed, once the grace period passes', async () => {
    await open('p5');
    // A crash after the closure commit but before delivery leaves no receipt.
    const crash = jest
      .spyOn(MonitorCycleService.prototype, 'notifyCycle')
      .mockRejectedValueOnce(new Error('process died'));
    await processor.tick(new Date(deadline.getTime() + 1000));
    crash.mockRestore();
    expect((await cycle('p5')).status).toBe('closed');
    expect((await cycle('p5')).notifiedAt).toBeNull();
    expect(processor.snapshot().notifyFailures).toBeGreaterThanOrEqual(1);
    // Inside the grace period nothing is retried.
    await processor.tick(new Date(deadline.getTime() + 20_000));
    expect((await cycle('p5')).notifiedAt).toBeNull();
    // The crash counted as one attempt, so repair waits two minutes after closure.
    await processor.tick(new Date(deadline.getTime() + 130_000));
    expect((await cycle('p5')).notifiedAt).not.toBeNull();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('isolates a failing cycle so the rest of the batch still closes', async () => {
    await open('p6');
    await open('p7');
    const spy = jest
      .spyOn(MonitorCycleService.prototype, 'closeCycle')
      .mockImplementationOnce(() => Promise.reject(new Error('poison')));
    await processor.tick(new Date(deadline.getTime() + 1000));
    spy.mockRestore();
    const statuses = [
      (await cycle('p6')).status,
      (await cycle('p7')).status,
    ].sort();
    expect(statuses).toEqual(['closed', 'open']);
    expect(processor.snapshot().cycleFailures).toBeGreaterThanOrEqual(1);
  });

  it('reports arrival lag and overdue age and deletes finished cycles past retention', async () => {
    await open('p8');
    await hint('p8', 'eu');
    await client`UPDATE monitor_cycle_arrivals SET created_at = ${new Date(t0.getTime() - 30_000).toISOString()}::timestamp WHERE cycle_id = 'p8'`;
    await client`UPDATE monitor_cycles SET status = 'closed', closed_by = 'deadline', result_status = 'down', closed_at = ${new Date(t0.getTime() - 40 * 86_400_000).toISOString()}::timestamp, notified_at = ${t0.toISOString()}::timestamp WHERE id = 'p8'`;
    await open('p9');
    // Retention sweeps are rate-limited to every 10 minutes; move the clock past that window.
    await processor.tick(new Date(deadline.getTime() + 3_600_000));
    const [gone] =
      await client`SELECT count(*)::int AS n FROM monitor_cycles WHERE id = 'p8'`;
    expect(gone.n).toBe(0);
    expect(processor.snapshot().retentionDeleted).toBeGreaterThanOrEqual(1);
    expect((await cycle('p9')).status).toBe('closed');
  });

  describe('review hardening', () => {
    it('keeps retention caught up when more than one batch is eligible', async () => {
      await client`INSERT INTO monitor_cycles (id, monitor_id, scheduled_for, deadline_at, expected_locations, strategy, threshold, status, closed_at, closed_by, result_status, notified_at)
        SELECT 'old-' || g, ${monitorId}::uuid, now() at time zone 'utc' - interval '40 days', now() at time zone 'utc' - interval '40 days', '["eu"]'::jsonb, 'all', 100, 'closed', now() at time zone 'utc' - interval '39 days', 'deadline', 'down', now() at time zone 'utc'
        FROM generate_series(1, 1200) g`;
      // Later than every earlier tick in this file: sweeps are rate-limited to every 10 minutes.
      await processor.tick(new Date(deadline.getTime() + 86_400_000));
      const [left] =
        await client`SELECT count(*)::int AS n FROM monitor_cycles WHERE id LIKE 'old-%'`;
      expect(left.n).toBe(0);
      expect(processor.snapshot().retentionDeleted).toBeGreaterThanOrEqual(
        1200,
      );
    });

    it('backs a repeatedly failing cycle off so healthy cycles still close', async () => {
      await open('poison');
      await open('healthy');
      const original = MonitorCycleService.prototype.closeCycle;
      const spy = jest
        .spyOn(MonitorCycleService.prototype, 'closeCycle')
        .mockImplementation(function (
          this: MonitorCycleService,
          id: string,
          at?: Date,
        ) {
          return id === 'poison'
            ? Promise.reject(new Error('deterministic failure'))
            : original.call(this, id, at);
        });
      const at = new Date(deadline.getTime() + 1000);
      await processor.tick(at);
      const firstCalls = spy.mock.calls.filter(
        ([id]) => id === 'poison',
      ).length;
      await processor.tick(at);
      // Second tick lands inside the backoff window: the poison cycle is not retried.
      expect(spy.mock.calls.filter(([id]) => id === 'poison').length).toBe(
        firstCalls,
      );
      expect((await cycle('healthy')).status).toBe('closed');
      expect((await cycle('poison')).status).toBe('open');
      spy.mockRestore();
    });

    it.each([
      [
        'a billing outage below its limit stays open',
        () => new BillingVerificationError('down'),
        { failures: 0, billingFailures: 19 },
        'open',
      ],
      [
        'a billing outage at its limit is aborted',
        () => new BillingVerificationError('down'),
        { failures: 0, billingFailures: 71 },
        'aborted',
      ],
      [
        'another persistent failure at its limit is aborted',
        () => new Error('poison'),
        { failures: 19, billingFailures: 0 },
        'aborted',
      ],
      [
        'a transient error after a long outage does not trip the lower limit',
        () => new Error('lock timeout'),
        { failures: 2, billingFailures: 60 },
        'open',
      ],
    ])('%s', async (_name, makeError, seed, status) => {
      await open('limit');
      const spy = jest
        .spyOn(MonitorCycleService.prototype, 'closeCycle')
        .mockRejectedValue(makeError());
      (processor as unknown as { failing: Map<string, unknown> }).failing.set(
        'limit',
        { ...seed, nextAt: 0 },
      );
      const before = processor.snapshot();
      await processor.tick(new Date(deadline.getTime() + 1000));
      expect((await cycle('limit')).status).toBe(status);
      const after = processor.snapshot();
      // Billing outages count as close failures too, so operators are alerted before an abort.
      expect(after.cycleFailures - before.cycleFailures).toBe(1);
      expect(after.abortedCycles - before.abortedCycles).toBe(
        status === 'aborted' ? 1 : 0,
      );
      spy.mockRestore();
    });

    it('does not count an abort that failed to persist', async () => {
      await open('abort-fails');
      const close = jest
        .spyOn(MonitorCycleService.prototype, 'closeCycle')
        .mockRejectedValue(new Error('poison'));
      const abort = jest
        .spyOn(MonitorCycleService.prototype, 'abortCycle')
        .mockRejectedValue(new Error('db down'));
      (processor as unknown as { failing: Map<string, unknown> }).failing.set(
        'abort-fails',
        { failures: 19, billingFailures: 0, nextAt: 0 },
      );
      const before = processor.snapshot().abortedCycles;
      await processor.tick(new Date(deadline.getTime() + 1000));
      expect(processor.snapshot().abortedCycles).toBe(before);
      expect((await cycle('abort-fails')).status).toBe('open');
      close.mockRestore();
      abort.mockRestore();
    });

    it('asks for an immediate next pass when a full batch of overdue cycles was found', async () => {
      await client`INSERT INTO monitor_cycles (id, monitor_id, scheduled_for, deadline_at, expected_locations, strategy, threshold)
        SELECT 'bulk-' || g, ${monitorId}::uuid, ${t0.toISOString()}::timestamp, ${deadline.toISOString()}::timestamp, '["eu"]'::jsonb, 'any', 100
        FROM generate_series(1, 60) g`;
      expect(await processor.tick(new Date(deadline.getTime() + 1000))).toBe(
        true,
      );
      expect(await processor.tick(new Date(deadline.getTime() + 2000))).toBe(
        false,
      );
      const [open] =
        await client`SELECT count(*)::int AS n FROM monitor_cycles WHERE status = 'open'`;
      expect(open.n).toBe(0);
    });

    it('waits one minute per failed attempt before repairing a notification', async () => {
      await open('backoff');
      await processor.tick(new Date(deadline.getTime() + 1000));
      await client`UPDATE monitor_cycles SET notified_at = NULL, notify_attempts = 2, closed_at = ${deadline.toISOString()}::timestamp WHERE id = 'backoff'`;
      sendNotification.mockClear();
      await processor.tick(new Date(deadline.getTime() + 150_000)); // inside 3 minutes
      expect((await cycle('backoff')).notifiedAt).toBeNull();
      await processor.tick(new Date(deadline.getTime() + 200_000)); // past 3 minutes
      expect((await cycle('backoff')).notifiedAt).not.toBeNull();
    });

    it('does not let one hanging notification stall other cycles, and counts it as an attempt', async () => {
      process.env.MISSING_CYCLE_NOTIFY_BUDGET_MS = '600';
      await open('hang');
      await open('quick');
      const original = MonitorCycleService.prototype.notifyCycle;
      const spy = jest
        .spyOn(MonitorCycleService.prototype, 'notifyCycle')
        .mockImplementation(function (this: MonitorCycleService, id: string) {
          return id === 'hang'
            ? new Promise<boolean>(() => undefined)
            : original.call(this, id);
        });
      const started = Date.now();
      await processor.tick(new Date(deadline.getTime() + 1000));
      spy.mockRestore();
      delete process.env.MISSING_CYCLE_NOTIFY_BUDGET_MS;
      expect(Date.now() - started).toBeLessThan(10_000);
      expect((await cycle('quick')).status).toBe('closed');
      expect((await cycle('quick')).notifiedAt).not.toBeNull();
      expect(await cycle('hang')).toMatchObject({
        status: 'closed',
        notifiedAt: null,
        notifyAttempts: 1,
      });
    });

    it('closes every due cycle before sending any notification', async () => {
      await open('o1');
      await open('o2');
      const order: string[] = [];
      const closeSpy = jest.spyOn(MonitorCycleService.prototype, 'closeCycle');
      const notifySpy = jest.spyOn(
        MonitorCycleService.prototype,
        'notifyCycle',
      );
      closeSpy.mockImplementation((id: string) => {
        order.push(`close:${id}`);
        return Promise.resolve('closed' as const);
      });
      notifySpy.mockImplementation(async (id: string) => {
        order.push(`notify:${id}`);
        return true;
      });
      await processor.tick(new Date(deadline.getTime() + 1000));
      closeSpy.mockRestore();
      notifySpy.mockRestore();
      const firstNotify = order.findIndex((entry) =>
        entry.startsWith('notify:'),
      );
      const lastClose = order
        .map((entry) => entry.startsWith('close:'))
        .lastIndexOf(true);
      expect(firstNotify).toBeGreaterThan(lastClose);
    });

    it('aborts an open cycle explicitly and records thrown notification failures as bounded attempts', async () => {
      await open('abortme');
      await processor['cycles'].abortCycle('abortme');
      expect(await cycle('abortme')).toMatchObject({ status: 'aborted' });
      await open('failing');
      await processor['cycles'].closeCycle(
        'failing',
        new Date(deadline.getTime() + 1000),
      );
      for (let i = 0; i < 5; i++)
        await processor['cycles'].recordNotifyFailure('failing');
      expect(await cycle('failing')).toMatchObject({ notifyAttempts: 5 });
      expect((await cycle('failing')).notifiedAt).not.toBeNull();
    });
  });
});

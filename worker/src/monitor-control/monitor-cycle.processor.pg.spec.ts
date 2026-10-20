/** Real-PostgreSQL tests for the polling processor. Skipped without MONITOR_CYCLE_TEST_DATABASE_URL. */

import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import type { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { MonitorCycleProcessor } from './monitor-cycle.processor';
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
    await processor.tick(new Date(deadline.getTime() + 120_000));
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
});

/**
 * Real-PostgreSQL tests for cycle closure. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is set
 * (CI sets it): races between closers cannot be proven with a mock. Migrations are applied by the
 * app's own runner into a throwaway database.
 */
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import type { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import { MonitorCycleService } from './monitor-cycle.service';
import type { BillingHoldService } from './billing-hold.service';
import { createTestDatabase, seedMonitor } from './pg-test-database';

jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('MonitorCycleService (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: MonitorCycleService;
  let monitorId: string;
  const sendNotification = jest.fn().mockResolvedValue({ successful: 1 });
  const alertService = {
    sendNotification,
    sendSslExpirationNotification: jest.fn(),
  } as unknown as MonitorAlertService;
  const isHeld = jest.fn().mockResolvedValue({ blocked: false });
  const billing = { isHeld } as unknown as BillingHoldService;

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    ({ client, db } = testDb);
    service = new MonitorCycleService(
      { db } as unknown as DbService,
      alertService,
      billing,
    );
  });

  afterAll(async () => {
    if (testDb) await testDb.drop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    isHeld.mockResolvedValue({ blocked: false });
    ({ monitorId } = await seedMonitor(db, client));
  });

  const t0 = new Date('2026-10-21T10:00:00Z');
  const deadline = new Date('2026-10-21T10:05:00Z');
  const afterDeadline = new Date('2026-10-21T10:05:01Z');

  async function openCycle(
    id: string,
    options: {
      locations?: string[];
      strategy?: 'all' | 'any' | 'majority';
      threshold?: number;
      scheduledFor?: Date;
      deadlineAt?: Date;
    } = {},
  ) {
    await db.insert(schema.monitorCycles).values({
      id,
      monitorId,
      scheduledFor: options.scheduledFor ?? t0,
      deadlineAt: options.deadlineAt ?? deadline,
      expectedLocations: options.locations ?? ['eu', 'us', 'ap'],
      strategy: options.strategy ?? 'majority',
      threshold: options.threshold ?? 50,
    });
  }

  async function report(
    cycleId: string,
    location: string,
    isUp: boolean,
    checkedAt = new Date(t0.getTime() + 1000),
  ) {
    await db.insert(schema.monitorResults).values({
      monitorId,
      location,
      checkedAt,
      status: isUp ? 'up' : 'down',
      isUp,
      responseTimeMs: isUp ? 120 : null,
      executionGroupId: cycleId,
    });
  }

  const cycleRow = async (id: string) =>
    (
      await db
        .select()
        .from(schema.monitorCycles)
        .where(eq(schema.monitorCycles.id, id))
    )[0];
  const monitorRow = async () =>
    (
      await db
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId))
    )[0];
  const results = (id: string) =>
    db
      .select()
      .from(schema.monitorResults)
      .where(eq(schema.monitorResults.executionGroupId, id));

  it('waits while quorum is still undecided and the deadline has not passed', async () => {
    await openCycle('c1', { strategy: 'all' });
    await report('c1', 'eu', true);
    expect(
      await service.closeCycle('c1', new Date(t0.getTime() + 10_000)),
    ).toBe('waiting');
    expect((await cycleRow('c1')).status).toBe('open');
  });

  it('closes a missing-region cycle down at the deadline with an explicit failed row', async () => {
    await openCycle('c2', { strategy: 'all' });
    await report('c2', 'eu', true);
    await report('c2', 'us', true);
    expect(await service.closeCycle('c2', afterDeadline)).toBe('closed');
    const cycle = await cycleRow('c2');
    expect(cycle).toMatchObject({
      status: 'closed',
      closedBy: 'deadline',
      resultStatus: 'down',
      missingLocations: ['ap'],
      notifiedAt: null,
    });
    expect(cycle.evaluation).toMatchObject({
      previousStatus: 'up',
      currentStatus: 'down',
    });
    const synthetic = (await results('c2')).filter(
      (r) => (r.details as { synthetic?: boolean })?.synthetic,
    );
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({
      location: 'ap',
      isUp: false,
      responseTimeMs: null,
    });
    expect((await monitorRow()).status).toBe('down');
  });

  it('closes an all-offline cycle exactly once, down, with every region missing', async () => {
    await openCycle('c3');
    expect(await service.closeCycle('c3', afterDeadline)).toBe('closed');
    expect(await cycleRow('c3')).toMatchObject({
      resultStatus: 'down',
      observedLocations: [],
      missingLocations: ['eu', 'us', 'ap'],
    });
    expect(await results('c3')).toHaveLength(3);
    expect((await monitorRow()).status).toBe('down');
  });

  it('closes early on a decisive arrival without writing failed rows for regions yet to report', async () => {
    await openCycle('c4');
    await report('c4', 'eu', true);
    await report('c4', 'us', true);
    expect(await service.closeCycle('c4', new Date(t0.getTime() + 5000))).toBe(
      'closed',
    );
    expect(await cycleRow('c4')).toMatchObject({
      closedBy: 'arrival',
      resultStatus: 'up',
      missingLocations: ['ap'],
    });
    expect(await results('c4')).toHaveLength(2);
  });

  it('closes a cycle once under concurrent closers and writes failed rows once', async () => {
    await openCycle('c5');
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => service.closeCycle('c5', afterDeadline)),
    );
    expect(outcomes.filter((o) => o === 'closed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'noop')).toHaveLength(5);
    expect(await results('c5')).toHaveLength(3);
  });

  it('serializes an arrival-driven and a deadline-driven closer into a single outcome', async () => {
    await openCycle('c6', { strategy: 'any' });
    await report('c6', 'eu', true);
    const outcomes = await Promise.all([
      service.closeCycle('c6', new Date(t0.getTime() + 2000)),
      service.closeCycle('c6', afterDeadline),
      service.closeCycle('c6', new Date(t0.getTime() + 3000)),
    ]);
    expect(outcomes.filter((o) => o === 'closed')).toHaveLength(1);
    expect(['arrival', 'deadline']).toContain((await cycleRow('c6')).closedBy);
    expect((await cycleRow('c6')).resultStatus).toBe('up');
  });

  it('keeps a late result diagnostic and never re-evaluates a closed cycle', async () => {
    await openCycle('c7', { strategy: 'all' });
    await report('c7', 'eu', true);
    await service.closeCycle('c7', afterDeadline);
    const before = await monitorRow();
    await report('c7', 'us', true, new Date(t0.getTime() + 400_000));
    expect(
      await service.closeCycle('c7', new Date(t0.getTime() + 500_000)),
    ).toBe('noop');
    const after = await monitorRow();
    expect(after.status).toBe(before.status);
    expect((await cycleRow('c7')).resultStatus).toBe('down');
  });

  it('does not let an older cycle overwrite newer monitor state', async () => {
    await openCycle('old', {
      scheduledFor: t0,
      deadlineAt: deadline,
      strategy: 'all',
    });
    const t1 = new Date(t0.getTime() + 60_000);
    await openCycle('new', {
      scheduledFor: t1,
      deadlineAt: new Date(t1.getTime() + 300_000),
      strategy: 'all',
    });
    for (const location of ['eu', 'us', 'ap'])
      await report('new', location, true, new Date(t1.getTime() + 1000));
    expect(await service.closeCycle('new', new Date(t1.getTime() + 5000))).toBe(
      'closed',
    );
    expect((await monitorRow()).status).toBe('up');
    expect(
      await service.closeCycle('old', new Date(t1.getTime() + 400_000)),
    ).toBe('superseded');
    const state = await monitorRow();
    expect(state.status).toBe('up');
    expect(state.lastCheckAt!.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    expect((await cycleRow('old')).notifiedAt).not.toBeNull();
    expect(await service.notifyCycle('old')).toBe(false);
  });

  it.each([
    [
      'paused',
      async () => {
        await db
          .update(schema.monitors)
          .set({ status: 'paused' })
          .where(eq(schema.monitors.id, monitorId));
      },
    ],
    [
      'disabled',
      async () => {
        await db
          .update(schema.monitors)
          .set({ enabled: false })
          .where(eq(schema.monitors.id, monitorId));
      },
    ],
    [
      'billing-held',
      async () => {
        isHeld.mockResolvedValue({
          blocked: true,
          reason: 'An active subscription is required',
        });
      },
    ],
  ])(
    'aborts a %s monitor instead of creating false downtime',
    async (_label, arrange) => {
      await openCycle('c8');
      await arrange();
      const before = await monitorRow();
      expect(await service.closeCycle('c8', afterDeadline)).toBe('aborted');
      expect(await cycleRow('c8')).toMatchObject({
        status: 'aborted',
        notifiedAt: expect.any(Date),
      });
      expect(await results('c8')).toHaveLength(0);
      expect((await monitorRow()).status).toBe(before.status);
    },
  );

  it('delivers once per closure and treats the receipt as the idempotency boundary', async () => {
    await openCycle('c9', { strategy: 'all' });
    await service.closeCycle('c9', afterDeadline);
    expect(await service.notifyCycle('c9')).toBe(true);
    expect(await service.notifyCycle('c9')).toBe(false);
    expect((await cycleRow('c9')).notifiedAt).not.toBeNull();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      monitorId,
      'failure',
      expect.stringContaining('no results from'),
      expect.anything(),
    );
  });

  it('can repair a notification after a crash between closure and delivery', async () => {
    await openCycle('c10', { strategy: 'all' });
    await service.closeCycle('c10', afterDeadline);
    // Crash simulated: closed, evaluation committed, no receipt yet.
    expect((await cycleRow('c10')).notifiedAt).toBeNull();
    expect(await service.notifyCycle('c10')).toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

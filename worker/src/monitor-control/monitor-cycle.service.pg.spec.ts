/**
 * Real-PostgreSQL tests for cycle closure. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is set
 * (CI sets it): races between closers cannot be proven with a mock. Migrations are applied by the
 * app's own runner into a throwaway database.
 */
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { MonitorService } from '../monitor/monitor.service';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import type { MonitorAlertService } from '../monitor/services/monitor-alert.service';
import {
  MAX_NOTIFY_ATTEMPTS,
  MonitorCycleService,
} from './monitor-cycle.service';
import {
  BillingVerificationError,
  type BillingHoldService,
} from './billing-hold.service';
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

  it('neutrally aborts a skipped regional group and retains observed diagnostics', async () => {
    await openCycle('skip-neutral');
    await report('skip-neutral', 'eu', false);
    const before = await db.query.monitors.findFirst({
      where: eq(schema.monitors.id, monitorId),
    });
    const worker = Object.assign(Object.create(MonitorService.prototype), {
      dbService: { db },
      logger: { warn: jest.fn() },
    }) as MonitorService;
    await worker.skipDistributedMonitorGroup(monitorId, 'skip-neutral', true);
    expect(
      await db.query.monitorCycles.findFirst({
        where: eq(schema.monitorCycles.id, 'skip-neutral'),
      }),
    ).toMatchObject({ status: 'aborted', notifiedAt: expect.any(Date) });
    await service.closeCycle('skip-neutral', afterDeadline);
    expect(
      await db.query.monitors.findFirst({
        where: eq(schema.monitors.id, monitorId),
      }),
    ).toEqual(before);
    expect(
      await db.query.monitorResults.findMany({
        where: eq(schema.monitorResults.executionGroupId, 'skip-neutral'),
      }),
    ).toHaveLength(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it.each([
    [false, 'down'],
    [true, 'up'],
  ])(
    'judges a cycle over the regions that ran when another went stale (eu up=%s)',
    async (euUp, expected) => {
      const id = `stale-${expected}`;
      await openCycle(id, { locations: ['eu', 'us'], strategy: 'all' });
      await report(id, 'eu', euUp);
      const worker = Object.assign(Object.create(MonitorService.prototype), {
        dbService: { db },
        logger: { warn: jest.fn() },
      }) as MonitorService;
      await worker.dropStaleRegion(monitorId, id, 'us', true, ['eu', 'us']);
      // Decided on arrival, well before the deadline, with no synthetic row for the stale region.
      expect(await service.closeCycle(id, t0)).toBe('closed');
      expect(await cycleRow(id)).toMatchObject({ resultStatus: expected });
      expect(await results(id)).toHaveLength(1);
    },
  );

  it('keeps every concurrent stale drop, so none returns to the expected set', async () => {
    await openCycle('stale-concurrent', {
      locations: ['eu', 'us', 'ap'],
      strategy: 'all',
    });
    await report('stale-concurrent', 'ap', true);
    const worker = Object.assign(Object.create(MonitorService.prototype), {
      dbService: { db },
      logger: { warn: jest.fn() },
    }) as MonitorService;
    await Promise.all(
      ['eu', 'us'].map((region) =>
        worker.dropStaleRegion(monitorId, 'stale-concurrent', region, true),
      ),
    );
    expect((await cycleRow('stale-concurrent')).expectedLocations).toEqual([
      'ap',
    ]);
    expect(await service.closeCycle('stale-concurrent', t0)).toBe('closed');
    expect(await results('stale-concurrent')).toHaveLength(1);
  });

  it('aborts a cycle whose every region went stale', async () => {
    await openCycle('stale-all', { locations: ['eu', 'us'] });
    const worker = Object.assign(Object.create(MonitorService.prototype), {
      dbService: { db },
      logger: { warn: jest.fn() },
    }) as MonitorService;
    await worker.dropStaleRegion(monitorId, 'stale-all', 'eu', true);
    await worker.dropStaleRegion(monitorId, 'stale-all', 'us', true);
    expect(await cycleRow('stale-all')).toMatchObject({ status: 'aborted' });
  });

  it('does not write synthetic Down rows for regions never enqueued (no live worker)', async () => {
    // The app snapshots only the enqueued regions, so the skipped third region is not expected.
    await openCycle('partial-skip', {
      locations: ['eu', 'us'],
      strategy: 'all',
    });
    await report('partial-skip', 'eu', true);
    await report('partial-skip', 'us', true);
    expect(await service.closeCycle('partial-skip', afterDeadline)).toBe(
      'closed',
    );
    expect(await results('partial-skip')).toHaveLength(2);
    expect(await cycleRow('partial-skip')).toMatchObject({
      resultStatus: 'up',
    });
  });

  it('does not replace an already closed cycle with an abort', async () => {
    await openCycle('skip-after-closed');
    await db
      .update(schema.monitorCycles)
      .set({ status: 'closed', resultStatus: 'up', closedAt: afterDeadline })
      .where(eq(schema.monitorCycles.id, 'skip-after-closed'));
    const worker = Object.assign(Object.create(MonitorService.prototype), {
      dbService: { db },
      logger: { warn: jest.fn() },
    }) as MonitorService;
    await worker.skipDistributedMonitorGroup(
      monitorId,
      'skip-after-closed',
      true,
    );
    expect(
      await db.query.monitorCycles.findFirst({
        where: eq(schema.monitorCycles.id, 'skip-after-closed'),
      }),
    ).toMatchObject({ status: 'closed', resultStatus: 'up' });
  });

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
      // The key was minted when the cycle closed and is the one committed with the counters.
      { outageKey: expect.any(String), ordinal: 0 },
    );
    const [stored] = await db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, monitorId));
    expect(
      (
        stored.config as {
          aggregatedAlertState?: { outageKey?: string };
        }
      ).aggregatedAlertState?.outageKey,
    ).toBe(sendNotification.mock.calls[0][4].outageKey);
  });

  it('can repair a notification after a crash between closure and delivery', async () => {
    await openCycle('c10', { strategy: 'all' });
    await service.closeCycle('c10', afterDeadline);
    // Crash simulated: closed, evaluation committed, no receipt yet.
    expect((await cycleRow('c10')).notifiedAt).toBeNull();
    expect(await service.notifyCycle('c10')).toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("notifies a delayed failure with the failing cycle's close-time observation, not a late result", async () => {
    await openCycle('fail', { strategy: 'all', locations: ['eu', 'us'] });
    await report('fail', 'eu', false, new Date(t0.getTime() + 1000));
    await report('fail', 'us', false, new Date(t0.getTime() + 2000));
    await service.closeCycle('fail', afterDeadline);
    const observedAt = new Date(t0.getTime() + 2000).toISOString();
    expect((await cycleRow('fail')).evaluation).toMatchObject({ observedAt });

    // A newer recovery cycle closes, then a late result from the failing cycle arrives.
    const later = new Date(t0.getTime() + 10 * 60_000);
    await openCycle('recover', {
      strategy: 'all',
      locations: ['eu', 'us'],
      scheduledFor: later,
      deadlineAt: new Date(later.getTime() + 300_000),
    });
    await report('recover', 'eu', true, new Date(later.getTime() + 1000));
    await report('recover', 'us', true, new Date(later.getTime() + 2000));
    await service.closeCycle('recover', new Date(later.getTime() + 400_000));
    await report('fail', 'eu', false, new Date(later.getTime() + 20_000));

    expect(await service.notifyCycle('fail')).toBe(true);
    expect(sendNotification).toHaveBeenCalledWith(
      monitorId,
      'failure',
      expect.any(String),
      expect.objectContaining({ observedAt }),
      { outageKey: expect.any(String), ordinal: 0 },
    );
  });

  describe('publish confirmation and frozen alert metadata', () => {
    const pending = (id: string) =>
      db
        .update(schema.monitorCycles)
        .set({ publishPending: true })
        .where(eq(schema.monitorCycles.id, id));

    it('aborts, never writes synthetic downs or alerts, for a cycle whose jobs were never published', async () => {
      await openCycle('unpub');
      await pending('unpub');
      expect(await service.closeCycle('unpub', afterDeadline)).toBe('aborted');
      expect(await cycleRow('unpub')).toMatchObject({ status: 'aborted' });
      expect(await results('unpub')).toHaveLength(0);
      expect(await service.notifyCycle('unpub')).toBe(false);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('treats an arrival hint as proof of publication when the flag was never cleared', async () => {
      await openCycle('arrival-only', {
        strategy: 'all',
        locations: ['eu', 'us'],
      });
      await pending('arrival-only');
      await db
        .insert(schema.monitorCycleArrivals)
        .values({ cycleId: 'arrival-only', location: 'eu' });
      expect(await service.closeCycle('arrival-only', afterDeadline)).toBe(
        'closed',
      );
      expect(await cycleRow('arrival-only')).toMatchObject({
        resultStatus: 'down',
      });
    });

    it('still closes a cycle with results even if the published flag was never cleared', async () => {
      await openCycle('stale-flag', {
        strategy: 'all',
        locations: ['eu', 'us'],
      });
      await pending('stale-flag');
      await report('stale-flag', 'eu', true);
      expect(await service.closeCycle('stale-flag', afterDeadline)).toBe(
        'closed',
      );
      expect(await results('stale-flag')).toHaveLength(2); // us is a genuine synthetic miss
    });

    it('keeps the legacy outage when an older app persisted the cycle (flag false)', async () => {
      await openCycle('legacy', { strategy: 'all', locations: ['eu', 'us'] });
      expect(await service.closeCycle('legacy', afterDeadline)).toBe('closed');
      expect(await cycleRow('legacy')).toMatchObject({ resultStatus: 'down' });
    });

    it('does not abort an unpublished cycle before its deadline', async () => {
      await openCycle('early-unpub');
      await pending('early-unpub');
      expect(await service.closeCycle('early-unpub', t0)).toBe('waiting');
      expect(await cycleRow('early-unpub')).toMatchObject({ status: 'open' });
    });

    it('reports the synthetic missing row, not a late real up result, in the alert metadata', async () => {
      await openCycle('late-up', { strategy: 'all', locations: ['eu', 'us'] });
      await report('late-up', 'eu', false, new Date(t0.getTime() + 1000));
      await service.closeCycle('late-up', afterDeadline);
      // us missed the deadline (synthetic down); then its real result lands.
      await report('late-up', 'us', true, new Date(t0.getTime() + 400_000));
      await report('late-up', 'eu', true, new Date(t0.getTime() + 410_000));
      expect(await service.notifyCycle('late-up')).toBe(true);
      const metadata = sendNotification.mock.calls[0][3] as {
        locationResults: Array<{ location: string; isUp: boolean }>;
      };
      expect(metadata.locationResults).toEqual([
        expect.objectContaining({ location: 'eu', isUp: false }),
        expect.objectContaining({ location: 'us', isUp: false }),
      ]);
    });

    it('falls back to the latest row for a cycle closed before observed locations were stored', async () => {
      await openCycle('old-row', { strategy: 'all', locations: ['eu', 'us'] });
      await report('old-row', 'eu', false, new Date(t0.getTime() + 1000));
      await report('old-row', 'us', false, new Date(t0.getTime() + 2000));
      await service.closeCycle('old-row', afterDeadline);
      await db
        .update(schema.monitorCycles)
        .set({ observedLocations: null, missingLocations: null })
        .where(eq(schema.monitorCycles.id, 'old-row'));
      await report('old-row', 'us', true, new Date(t0.getTime() + 500_000));
      await service.notifyCycle('old-row');
      const metadata = sendNotification.mock.calls[0][3] as {
        locationResults: Array<{ location: string; isUp: boolean }>;
      };
      expect(
        metadata.locationResults.find((r) => r.location === 'us')?.isUp,
      ).toBe(true);
    });

    it('keeps a region pending after an early closure even when its late result lands before the alert', async () => {
      await openCycle('early-late', {
        strategy: 'any',
        locations: ['eu', 'us'],
      });
      await report('early-late', 'eu', true, new Date(t0.getTime() + 1000));
      expect(await service.closeCycle('early-late', t0)).toBe('closed');
      await report('early-late', 'us', true, new Date(t0.getTime() + 2000));
      const rows = await results('early-late');
      const cycle = await cycleRow('early-late');
      expect(cycle.missingLocations).toEqual(['us']);
      expect(service['frozenRow'](cycle, 'us', rows)).toBeUndefined(); // reported as pending
      expect(service['frozenRow'](cycle, 'eu', rows)).toMatchObject({
        isUp: true,
      });
    });

    it('ignores a late result for an observed region when building alert metadata', async () => {
      await openCycle('late-pending', {
        strategy: 'any',
        locations: ['eu', 'us'],
      });
      await report('late-pending', 'eu', false, new Date(t0.getTime() + 1000));
      await report('late-pending', 'us', false, new Date(t0.getTime() + 2000));
      await service.closeCycle('late-pending', afterDeadline);
      await report(
        'late-pending',
        'us',
        true,
        new Date(t0.getTime() + 500_000),
      );
      await service.notifyCycle('late-pending');
      const metadata = sendNotification.mock.calls[0][3] as {
        locationResults: Array<{ location: string; isUp: boolean }>;
      };
      expect(
        metadata.locationResults.find((r) => r.location === 'us')?.isUp,
      ).toBe(false);
    });
  });

  describe('review hardening', () => {
    it('keeps the cycle without a receipt when delivery fails, backs off and gives up after bounded attempts', async () => {
      await openCycle('r1', { strategy: 'all' });
      await service.closeCycle('r1', afterDeadline);
      sendNotification.mockResolvedValue({ delivered: false, successful: 0 });
      expect(await service.notifyCycle('r1')).toBe(false);
      expect(await cycleRow('r1')).toMatchObject({
        notifiedAt: null,
        notifyAttempts: 1,
      });
      for (let attempt = 2; attempt < MAX_NOTIFY_ATTEMPTS; attempt++) {
        expect(await service.notifyCycle('r1')).toBe(false);
      }
      expect((await cycleRow('r1')).notifiedAt).toBeNull();
      // The final attempt gives up and writes the receipt so the backlog clears.
      expect(await service.notifyCycle('r1')).toBe(true);
      expect(await cycleRow('r1')).toMatchObject({
        notifyAttempts: MAX_NOTIFY_ATTEMPTS,
      });
      expect((await cycleRow('r1')).notifiedAt).not.toBeNull();
      sendNotification.mockResolvedValue({ successful: 1 });
    });

    it('does not count an attempt the caller already abandoned', async () => {
      await openCycle('r1a', { strategy: 'all' });
      await service.closeCycle('r1a', afterDeadline);
      sendNotification.mockResolvedValue({ delivered: false, successful: 0 });
      expect(await service.notifyCycle('r1a', { abandoned: true })).toBe(false);
      expect(await cycleRow('r1a')).toMatchObject({
        notifiedAt: null,
        notifyAttempts: 0,
      });
      sendNotification.mockResolvedValue({ successful: 1 });
    });

    it('fails a closure fast instead of waiting forever on a locked monitor row', async () => {
      await openCycle('lk', { strategy: 'all' });
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const holder = client.begin(async (tx) => {
        await tx.unsafe('SELECT 1 FROM monitors WHERE id = $1 FOR UPDATE', [
          monitorId,
        ]);
        await held;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const started = Date.now();
      await expect(service.closeCycle('lk', afterDeadline)).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(10_000);
      release();
      await holder;
      expect(await service.closeCycle('lk', afterDeadline)).toBe('closed');
    }, 20_000);

    it('treats a provider that throws like a failed delivery', async () => {
      await openCycle('r2', { strategy: 'all' });
      await service.closeCycle('r2', afterDeadline);
      sendNotification.mockRejectedValueOnce(new Error('smtp down'));
      expect(await service.notifyCycle('r2')).toBe(false);
      expect((await cycleRow('r2')).notifiedAt).toBeNull();
      expect(await service.notifyCycle('r2')).toBe(true);
      expect((await cycleRow('r2')).notifiedAt).not.toBeNull();
    });

    it('does not count a deliberately suppressed alert as a failure', async () => {
      await openCycle('r3', { strategy: 'all' });
      await service.closeCycle('r3', afterDeadline);
      sendNotification.mockResolvedValueOnce({ suppressed: true });
      expect(await service.notifyCycle('r3')).toBe(true);
      expect(await cycleRow('r3')).toMatchObject({ notifyAttempts: 0 });
    });

    it('never evaluates a cycle an older-image worker already aggregated through the legacy path', async () => {
      await openCycle('r4', { strategy: 'all' });
      await db.insert(schema.monitorResults).values({
        monitorId,
        location: 'eu',
        checkedAt: t0,
        status: 'up',
        isUp: true,
        executionGroupId: 'r4',
        details: {
          aggregationEvaluation: { previousStatus: 'up', currentStatus: 'up' },
        },
      });
      const before = await monitorRow();
      expect(await service.closeCycle('r4', afterDeadline)).toBe('superseded');
      expect((await monitorRow()).status).toBe(before.status);
      expect((await cycleRow('r4')).notifiedAt).not.toBeNull();
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('leaves the cycle open and untouched when billing cannot be verified', async () => {
      await openCycle('r5');
      isHeld.mockRejectedValueOnce(
        new BillingVerificationError('Unable to verify monitor quota'),
      );
      await expect(
        service.closeCycle('r5', afterDeadline),
      ).rejects.toBeInstanceOf(BillingVerificationError);
      expect((await cycleRow('r5')).status).toBe('open');
      expect(await results('r5')).toHaveLength(0);
      expect((await monitorRow()).status).toBe('up');
      expect(await service.closeCycle('r5', afterDeadline)).toBe('closed');
    });

    it('orders cycles by scheduled time, so a slow older region cannot mask a newer outage', async () => {
      await openCycle('slow', {
        scheduledFor: t0,
        deadlineAt: deadline,
        strategy: 'all',
      });
      const t1 = new Date(t0.getTime() + 60_000);
      await openCycle('next', {
        scheduledFor: t1,
        deadlineAt: new Date(t1.getTime() + 300_000),
        strategy: 'all',
      });
      // The older cycle's region finishes AFTER the newer cycle was scheduled.
      await report('slow', 'eu', true, new Date(t1.getTime() + 20_000));
      await report('slow', 'us', true, new Date(t1.getTime() + 20_000));
      await report('slow', 'ap', true, new Date(t1.getTime() + 20_000));
      expect(
        await service.closeCycle('next', new Date(t1.getTime() + 400_000)),
      ).toBe('closed');
      expect((await monitorRow()).status).toBe('down');
      expect(
        await service.closeCycle('slow', new Date(t1.getTime() + 410_000)),
      ).toBe('superseded');
      expect((await monitorRow()).status).toBe('down');
    });

    it('does not deadlock with a monitor delete that cascades to its cycles', async () => {
      for (let round = 0; round < 6; round++) {
        const { monitorId: id } = await seedMonitor(db, client);
        monitorId = id;
        await openCycle(`d${round}`);
        const settled = await Promise.allSettled([
          service.closeCycle(`d${round}`, afterDeadline),
          db.delete(schema.monitors).where(eq(schema.monitors.id, id)),
        ]);
        for (const outcome of settled) {
          if (outcome.status === 'rejected') {
            expect(String(outcome.reason)).not.toMatch(/deadlock/i);
          }
        }
      }
    });

    it('aborts a cycle with no expected regions instead of closing it down', async () => {
      await openCycle('r6', { locations: [] });
      expect(await service.closeCycle('r6', afterDeadline)).toBe('aborted');
      expect(await results('r6')).toHaveLength(0);
    });

    it('handles a single-region monitor through the same path and notifies', async () => {
      await openCycle('r7', { locations: ['eu'], strategy: 'any' });
      expect(await service.closeCycle('r7', afterDeadline)).toBe('closed');
      expect(await cycleRow('r7')).toMatchObject({
        resultStatus: 'down',
        missingLocations: ['eu'],
      });
      expect(await service.notifyCycle('r7')).toBe(true);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('describes regions that have not reported yet as awaiting, not failed, on an early closure', async () => {
      await openCycle('r8', { strategy: 'all' });
      await report('r8', 'eu', false);
      await service.closeCycle('r8', new Date(t0.getTime() + 3000));
      expect((await cycleRow('r8')).evaluation?.reason).toMatch(
        /awaiting results from us, ap/,
      );
      expect(await results('r8')).toHaveLength(1);
    });
  });
});

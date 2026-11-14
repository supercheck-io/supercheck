/**
 * Real-PostgreSQL test for the job alert-streak query. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is
 * set (CI sets it); migrations are applied by the app's own runner into a throwaway database.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  createTestDatabase,
  seedMonitor,
} from '../../monitor-control/pg-test-database';
import { DbService } from './db.service';
import { isFailureAlertStreak } from './job-notification.service';

jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('DbService.getJobAlertStreakState (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: DbService;
  let jobId: string;
  let projectId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    service = new DbService(testDb.db, {} as never);
  });

  afterAll(async () => {
    if (testDb) await testDb.drop();
  });

  beforeEach(async () => {
    const { db, client } = testDb;
    const { organizationId } = await seedMonitor(db, client);
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    const [job] = await db
      .insert(schema.jobs)
      .values({
        organizationId,
        projectId: project.id,
        name: 'J',
        jobType: 'playwright',
        cronSchedule: null,
      } as never)
      .returning();
    jobId = job.id;
    projectId = project.id;
  });

  const run = (status: string, at: string) =>
    testDb.db.insert(schema.runs).values({
      jobId,
      projectId,
      status,
      trigger: 'manual',
      createdAt: new Date(at),
    } as never);
  const alert = (provider: string, status: string, at: string) =>
    testDb.db.insert(schema.alertHistory).values({
      jobId,
      provider,
      status: status as never,
      type: 'job_timeout',
      target: 'J',
      targetType: 'job',
      message: 'm',
      sentAt: new Date(at),
    });

  it('counts delivered alerts per streak and per fan-out, ignoring undelivered and older streaks', async () => {
    await alert('p1', 'sent', '2026-01-01T00:00:01Z'); // previous streak
    await run('passed', '2026-01-01T00:01:00Z');
    await run('failed', '2026-01-01T00:02:00Z');
    await alert('p1', 'sent', '2026-01-01T00:02:30Z');
    await alert('p2', 'sent', '2026-01-01T00:02:30Z'); // same alert, second provider
    await alert('p2', 'failed', '2026-01-01T00:03:30Z'); // undelivered: not counted
    await run('failed', '2026-01-01T00:04:00Z');
    await alert('p1', 'sent', '2026-01-01T00:04:30Z');

    const state = await service.getJobAlertStreakState(jobId);
    expect(state.sent).toBe(2);
    expect(state.lastSentAt).toEqual(new Date('2026-01-01T00:04:30Z'));
  });

  it('leaves out an old-streak alert delivered after the passing run started but before it finished', async () => {
    await testDb.db.insert(schema.runs).values({
      jobId,
      projectId,
      status: 'passed',
      trigger: 'manual',
      createdAt: new Date('2026-01-01T00:01:00Z'),
      completedAt: new Date('2026-01-01T00:03:00Z'),
    } as never);
    await alert('p1', 'sent', '2026-01-01T00:02:00Z'); // earlier failure's alert, delivered late
    await run('failed', '2026-01-01T00:04:00Z');
    expect((await service.getJobAlertStreakState(jobId)).sent).toBe(0);
  });

  it('reports no alerts for a job with no history', async () => {
    await run('failed', '2026-01-01T00:02:00Z');
    expect(await service.getJobAlertStreakState(jobId)).toEqual({
      sent: 0,
      lastSentAt: null,
    });
  });

  it('counts a pending reservation as an alert, so a crash before sending cannot add one', async () => {
    await run('failed', '2026-01-01T00:02:00Z');
    await alert('p1', 'pending', '2026-01-01T00:02:30Z');
    expect((await service.getJobAlertStreakState(jobId)).sent).toBe(1);
  });

  describe('getOpenJobPages', () => {
    const page = (
      provider: string,
      type: string,
      status: string,
      reservedAt: string,
      deliveredAt?: string,
    ) =>
      testDb.db.insert(schema.alertHistory).values({
        jobId,
        provider,
        status: status as never,
        type: type as never,
        target: 'J',
        targetType: 'job',
        message: 'm',
        sentAt: new Date(reservedAt),
        deliveryMetadata: deliveredAt
          ? ({ delivery: { status, sentAt: deliveredAt } } as never)
          : null,
      });

    it('is open after a delivered failure, closed after a delivered resolve, and ignores failed sends', async () => {
      await page('open', 'job_failed', 'sent', '2026-01-01T00:01:00Z');
      await page('closed', 'job_failed', 'sent', '2026-01-01T00:01:00Z');
      await page('closed', 'job_success', 'sent', '2026-01-01T00:02:00Z');
      await page(
        'undelivered',
        'job_timeout',
        'failed',
        '2026-01-01T00:01:00Z',
      );
      expect(
        await service.getOpenJobPages(jobId, ['open', 'closed', 'undelivered']),
      ).toEqual(new Set(['open']));
      expect(await service.getOpenJobPages(jobId, [])).toEqual(new Set());
    });

    it('orders by when the send finished: a failure reserved before a resolve but delivered after it reopens the page', async () => {
      await page(
        'p1',
        'job_failed',
        'sent',
        '2026-01-01T00:01:00Z',
        '2026-01-01T00:03:00Z',
      );
      await page(
        'p1',
        'job_success',
        'sent',
        '2026-01-01T00:02:00Z',
        '2026-01-01T00:02:00Z',
      );
      expect(await service.getOpenJobPages(jobId, ['p1'])).toEqual(
        new Set(['p1']),
      );
    });
  });

  describe('claimJobAlertSlots', () => {
    const claim = (
      runId: string,
      shouldAlert: (state: { sent: number }) => boolean = () => true,
      providerIds = ['p1', 'p2'],
    ) =>
      service.claimJobAlertSlots({
        jobId,
        runId,
        type: 'job_failed',
        providerIds,
        message: 'm',
        jobName: 'J',
        shouldAlert,
      });
    const rowStatus = async (runId: string, provider: string) =>
      (
        await testDb.client<{ status: string }[]>`
          SELECT status FROM alert_history WHERE job_id = ${jobId} AND run_id = ${runId} AND provider = ${provider}`
      )[0]?.status;

    it('reserves one pending row per provider and refuses a second claim for the same run', async () => {
      const runId = randomUUID();
      const first = await claim(runId);
      expect([...first.keys()].sort()).toEqual(['p1', 'p2']);
      expect(await rowStatus(runId, 'p1')).toBe('pending');
      expect((await claim(runId)).size).toBe(0);
      expect(await service.getJobAlertStreakState(jobId)).toMatchObject({
        sent: 1,
      });
    });

    it('reclaims only a failed row, and only for the provider that failed', async () => {
      const runId = randomUUID();
      const first = await claim(runId);
      await service.finishJobAlert(first.get('p1')!, 'sent');
      await service.finishJobAlert(first.get('p2')!, 'failed', 'boom');
      const retry = await claim(runId);
      expect([...retry.keys()]).toEqual(['p2']);
      expect(await rowStatus(runId, 'p2')).toBe('pending');
      expect(await rowStatus(runId, 'p1')).toBe('sent');
    });

    it('never reclaims a terminal (401/403) failure', async () => {
      const runId = randomUUID();
      const first = await claim(runId);
      const metadata = (terminal: boolean) =>
        ({
          version: 1,
          provider: { id: 'x' },
          source: {
            alertType: 'job_failed',
            targetType: 'job',
            targetId: jobId,
          },
          delivery: {
            status: 'failed',
            sentAt: new Date().toISOString(),
            terminal,
          },
        }) as never;
      await service.finishJobAlert(
        first.get('p1')!,
        'failed',
        'auth',
        metadata(true),
      );
      await service.finishJobAlert(
        first.get('p2')!,
        'failed',
        'boom',
        metadata(false),
      );
      const retry = await claim(runId);
      expect([...retry.keys()]).toEqual(['p2']);
      expect(await rowStatus(runId, 'p1')).toBe('failed');
    });

    it('lets concurrent runs claim at most the cap allows', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () =>
          claim(randomUUID(), (state) => state.sent < 2, ['p1']),
        ),
      );
      expect(outcomes.filter((claimed) => claimed.size > 0)).toHaveLength(2);
    });

    // The gate job-notification builds: threshold 1, runs counted by position in the streak.
    const realGate =
      (consecutiveFailures: number) =>
      (state: { sent: number; lastSentAt: Date | null }) =>
        isFailureAlertStreak(
          consecutiveFailures,
          1,
          state.sent,
          state.lastSentAt ? 0 : consecutiveFailures,
        );

    it('re-drives a partly delivered run through the real gate: only the failed provider is claimed', async () => {
      const runId = randomUUID();
      await run('failed', '2026-01-01T00:02:00Z');
      const first = await claim(runId, realGate(1));
      await service.finishJobAlert(first.get('p1')!, 'sent');
      await service.finishJobAlert(
        first.get('p2')!,
        'failed',
        'boom',
        {} as never,
      );
      const retry = await claim(runId, realGate(1));
      expect([...retry.keys()]).toEqual(['p2']);
      expect(await rowStatus(runId, 'p1')).toBe('sent');
      const [row] = await testDb.client<
        { error_message: string | null; delivery_metadata: unknown }[]
      >`SELECT error_message, delivery_metadata FROM alert_history WHERE run_id = ${runId} AND provider = 'p2'`;
      expect(row).toEqual({ error_message: null, delivery_metadata: null });
    });

    it("counts other runs' alerts toward the cap but not the run's own", async () => {
      const cap = (state: { sent: number }) => state.sent < 1;
      const runA = randomUUID();
      const runB = randomUUID();
      expect((await claim(runA, cap, ['p1'])).size).toBe(1);
      expect((await claim(runB, cap, ['p1'])).size).toBe(0);
    });

    it('a pending row for another run leaves this run claimable while the cap is not reached', async () => {
      const runA = randomUUID();
      const runB = randomUUID();
      await claim(runA, () => true, ['p1']);
      const claimed = await claim(runB, (state) => state.sent < 2, ['p1']);
      expect([...claimed.keys()]).toEqual(['p1']);
      expect(await rowStatus(runA, 'p1')).toBe('pending');
    });

    it('never conflicts rows that carry no run id', async () => {
      const save = () =>
        service.saveAlertHistory(
          jobId,
          'job_failed',
          'p1',
          'sent',
          'm',
          undefined,
          'J',
        );
      await save();
      await save();
      expect(
        (await testDb.client`SELECT 1 FROM alert_history WHERE run_id IS NULL`)
          .length,
      ).toBe(2);
    });
  });
});

/**
 * Real-PostgreSQL test for the job alert-streak query. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is
 * set (CI sets it); migrations are applied by the app's own runner into a throwaway database.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  createTestDatabase,
  seedMonitor,
} from '../../monitor-control/pg-test-database';
import { DbService } from './db.service';

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
});

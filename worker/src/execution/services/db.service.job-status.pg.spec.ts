/**
 * Real-PostgreSQL test for job status derivation from runs. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is
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

suite('DbService.syncJobStatusFromRuns (PostgreSQL)', () => {
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

  const run = async (status: string, at: string) =>
    (
      await testDb.db
        .insert(schema.runs)
        .values({
          jobId,
          projectId,
          status,
          trigger: 'manual',
          createdAt: new Date(at),
        } as never)
        .returning({ id: schema.runs.id })
    )[0].id;
  const jobStatus = async () =>
    (
      await testDb.db
        .select({ status: schema.jobs.status })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId))
    )[0].status;
  const setRun = (id: string, status: string) =>
    testDb.db
      .update(schema.runs)
      .set({ status } as never)
      .where(eq(schema.runs.id, id));

  it('newer run finishing first, then the older one, leaves the newest run status and does not stick on running', async () => {
    const a = await run('running', '2026-01-01T00:01:00Z');
    const b = await run('running', '2026-01-01T00:02:00Z');
    await setRun(b, 'passed');
    await service.syncJobStatusFromRuns(jobId);
    expect(await jobStatus()).toBe('running'); // A is still active
    await setRun(a, 'failed');
    await service.syncJobStatusFromRuns(jobId);
    expect(await jobStatus()).toBe('passed'); // B is the newest run
  });

  it('maps a blocked newest run to error and ignores an older failure once a newer run passed', async () => {
    await run('failed', '2026-01-01T00:01:00Z');
    await run('passed', '2026-01-01T00:02:00Z');
    await service.syncJobStatusFromRuns(jobId);
    expect(await jobStatus()).toBe('passed');
    await run('blocked', '2026-01-01T00:03:00Z');
    await service.syncJobStatusFromRuns(jobId);
    expect(await jobStatus()).toBe('error');
  });

  it('leaves the status unchanged when the job has no runs', async () => {
    const before = await jobStatus();
    await service.syncJobStatusFromRuns(jobId);
    expect(await jobStatus()).toBe(before);
  });
});

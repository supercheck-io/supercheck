/**
 * Real-PostgreSQL test: a run of an organization pending deletion (or of a soft-deleted project) must not start. Skipped
 * unless MONITOR_CYCLE_TEST_DATABASE_URL is set; migrations are applied by the app's own runner into a throwaway database.
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

suite('DbService.claimRunExecution and pending deletion (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: DbService;
  let organizationId: string;
  let projectId: string;
  let jobId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    service = new DbService(testDb.db, {} as never);
  });
  afterAll(async () => {
    if (testDb) await testDb.drop();
  });
  beforeEach(async () => {
    const { db, client } = testDb;
    ({ organizationId } = await seedMonitor(db, client));
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    projectId = project.id;
    const [job] = await db
      .insert(schema.jobs)
      .values({
        organizationId,
        projectId,
        name: 'J',
        jobType: 'playwright',
        cronSchedule: null,
      } as never)
      .returning();
    jobId = job.id;
  });

  const queuedRun = async () =>
    (
      await testDb.db
        .insert(schema.runs)
        .values({
          jobId,
          projectId,
          status: 'queued',
          trigger: 'manual',
        } as never)
        .returning({ id: schema.runs.id })
    )[0].id;
  const runRow = async (id: string) =>
    (
      await testDb.db.select().from(schema.runs).where(eq(schema.runs.id, id))
    )[0];

  it('claims a run of a normal organization', async () => {
    const id = await queuedRun();
    expect(await service.claimRunExecution(id)).toBe(true);
    expect((await runRow(id)).status).toBe('running');
  });

  it('refuses a run of an organization pending deletion and marks it cancelled so it is finalized, not left queued', async () => {
    const id = await queuedRun();
    await testDb.db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, organizationId));
    expect(await service.claimRunExecution(id)).toBe(false);
    expect((await runRow(id)).errorDetails).toBe(
      'Cancellation requested by user',
    );
    expect(await service.finalizeCancelledRun(id)).toBe(true);
    expect((await runRow(id)).status).toBe('error');
  });

  it('refuses a run of a soft-deleted project', async () => {
    const id = await queuedRun();
    await testDb.db
      .update(schema.projects)
      .set({ status: 'deleted' })
      .where(eq(schema.projects.id, projectId));
    expect(await service.claimRunExecution(id)).toBe(false);
  });

  it('claims again after the deletion is cancelled (the predicate reads the database, not a cache)', async () => {
    await testDb.db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, organizationId));
    const refused = await queuedRun();
    expect(await service.claimRunExecution(refused)).toBe(false);
    await testDb.db
      .update(schema.organization)
      .set({ deletionRequestedAt: null })
      .where(eq(schema.organization.id, organizationId));
    const allowed = await queuedRun();
    expect(await service.claimRunExecution(allowed)).toBe(true);
  });
});

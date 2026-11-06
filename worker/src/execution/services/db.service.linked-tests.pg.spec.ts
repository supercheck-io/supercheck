/**
 * Real-PostgreSQL test for per-test requirement status. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is set.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import {
  createTestDatabase,
  seedMonitor,
} from '../../monitor-control/pg-test-database';
import { DbService } from './db.service';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';

jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('DbService.getLinkedTestsWithStatus (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let service: DbService;

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    service = new DbService(testDb.db, {} as never);
  });

  afterAll(async () => {
    if (testDb) await testDb.drop();
  });

  async function seed() {
    const { db } = testDb;
    const { organizationId } = await seedMonitor(db, testDb.client);
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    const base = { organizationId, projectId: project.id };
    const [job] = await db
      .insert(schema.jobs)
      .values({ ...base, name: 'J', jobType: 'playwright' } as never)
      .returning();
    const [a, b] = await db
      .insert(schema.tests)
      .values([
        { ...base, title: 'A', type: 'browser' },
        { ...base, title: 'B', type: 'browser' },
      ] as never)
      .returning();
    await db.insert(schema.jobTests).values([
      { jobId: job.id, testId: a.id },
      { jobId: job.id, testId: b.id },
    ]);
    const [requirement] = await db
      .insert(schema.requirements)
      .values({ ...base, title: 'R' } as never)
      .returning();
    return { job, project, a, b, requirement };
  }

  const run = (
    ctx: { job: { id: string }; project: { id: string } },
    status: string,
    at: string,
    metadata?: Record<string, unknown>,
  ) =>
    testDb.db.insert(schema.runs).values({
      jobId: ctx.job.id,
      projectId: ctx.project.id,
      status,
      trigger: 'manual',
      createdAt: new Date(at),
      completedAt: new Date(at),
      ...(metadata ? { metadata } : {}),
    } as never);

  it('uses the per-test outcome of the latest run, so one failing test does not fail its siblings', async () => {
    const ctx = await seed();
    await testDb.db.insert(schema.testRequirements).values([
      { testId: ctx.a.id, requirementId: ctx.requirement.id },
      { testId: ctx.b.id, requirementId: ctx.requirement.id },
    ]);
    await run(ctx, 'passed', '2026-01-01T00:00:00Z');
    await run(ctx, 'failed', '2026-01-02T00:00:00Z', {
      testStatuses: { [ctx.a.id]: 'passed', [ctx.b.id]: 'failed' },
    });

    const result = await service.getLinkedTestsWithStatus(
      ctx.requirement.id,
      'org',
    );
    expect(Object.fromEntries(result.map((r) => [r.testId, r.status]))).toEqual(
      { [ctx.a.id]: 'passed', [ctx.b.id]: 'failed' },
    );
  });

  it('counts a skipped test as neither passed nor failed', async () => {
    const ctx = await seed();
    await testDb.db
      .insert(schema.testRequirements)
      .values([{ testId: ctx.a.id, requirementId: ctx.requirement.id }]);
    await run(ctx, 'passed', '2026-01-02T00:00:00Z', {
      testStatuses: { [ctx.a.id]: 'skipped' },
    });
    const result = await service.getLinkedTestsWithStatus(
      ctx.requirement.id,
      'org',
    );
    expect(result.map((r) => r.status)).toEqual([null]);
  });

  it('falls back to the run status when the run has no per-test outcomes', async () => {
    const ctx = await seed();
    await testDb.db.insert(schema.testRequirements).values([
      { testId: ctx.a.id, requirementId: ctx.requirement.id },
      { testId: ctx.b.id, requirementId: ctx.requirement.id },
    ]);
    await run(ctx, 'failed', '2026-01-02T00:00:00Z', {
      testStatuses: { [ctx.a.id]: 'passed', [ctx.b.id]: 'failed' },
    });
    await run(ctx, 'failed', '2026-01-03T00:00:00Z'); // legacy run, newest

    const result = await service.getLinkedTestsWithStatus(
      ctx.requirement.id,
      'org',
    );
    expect(result.map((r) => r.status)).toEqual(['failed', 'failed']);
  });

  it('ignores a cancelled run: the latest non-cancelled run decides coverage', async () => {
    const ctx = await seed();
    await testDb.db
      .insert(schema.testRequirements)
      .values([{ testId: ctx.a.id, requirementId: ctx.requirement.id }]);
    await run(ctx, 'passed', '2026-01-01T00:00:00Z');
    // A cancelled run is stored as 'error' with the cancellation marker and no per-test outcomes.
    await testDb.db.insert(schema.runs).values({
      jobId: ctx.job.id,
      projectId: ctx.project.id,
      status: 'error',
      trigger: 'manual',
      errorDetails: RUN_CANCELLATION_MARKER,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      completedAt: new Date('2026-01-02T00:00:00Z'),
    } as never);

    const result = await service.getLinkedTestsWithStatus(
      ctx.requirement.id,
      'org',
    );
    expect(result.map((r) => r.status)).toEqual(['passed']);
  });

  it('merges run metadata without clobbering existing keys', async () => {
    const ctx = await seed();
    await run(ctx, 'passed', '2026-01-01T00:00:00Z', { testId: 'keep' });
    const [row] = await testDb.db.select().from(schema.runs);
    await service.mergeRunMetadata(row.id, { testStatuses: { x: 'passed' } });
    const [after] = await testDb.db.select().from(schema.runs);
    expect(after.metadata).toEqual({
      testId: 'keep',
      testStatuses: { x: 'passed' },
    });
  });
});

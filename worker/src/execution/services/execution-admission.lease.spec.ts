import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import {
  ExecutionAdmissionService,
  ExecutionCapacityError,
  ExecutionEntitlementError,
} from './execution-admission.service';

/** The 0039 statements that touch execution_entitlements (the specs create only that table). */
function entitlementStatementsOf0039(path: string): string {
  return readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => {
      // Skip leading comment lines, then look at how the statement starts (no regex: no backtracking).
      const body = statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trimStart();
      return [
        'ALTER TABLE "execution_entitlements"',
        'UPDATE "execution_entitlements"',
        'CREATE INDEX "execution_entitlements_',
      ].some((prefix) => body.startsWith(prefix));
    })
    .join('\n');
}

jest.setTimeout(60_000);

/**
 * Runs the real reservation SQL (row locks, lease comparison, takeover) against
 * an embedded PostgreSQL using the shipped migration.
 */
describe('execution reservation lease (embedded PostgreSQL)', () => {
  const orgId = '00000000-0000-4000-8000-000000000001';
  const original = process.env.SELF_HOSTED;
  let pg: PGlite;
  let service: ExecutionAdmissionService;

  const reservations = async () =>
    (
      await pg.query<{
        run_id: string;
        used_ms: string;
        finished_at: string | null;
      }>(
        'SELECT run_id, used_ms, finished_at FROM execution_reservations ORDER BY run_id',
      )
    ).rows;
  const expireLeases = () =>
    pg.exec(
      "UPDATE execution_reservations SET lease_expires_at = now() - interval '1 second'",
    );
  const playwrightUsedMs = async () =>
    Number(
      (
        await pg.query<{ used: string }>(
          'SELECT playwright_used_ms AS used FROM execution_entitlements',
        )
      ).rows[0].used,
    );

  beforeAll(async () => {
    pg = new PGlite();
    const { name, columns } = getTableConfig(schema.organization as PgTable);
    await pg.exec(
      `CREATE TABLE "${name}" (${columns
        .map(
          (column) =>
            `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`,
        )
        .join(', ')})`,
    );
    await pg.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../../app/src/db/migrations/0037_execution_entitlements.sql',
        ),
        'utf8',
      ).replaceAll('uuidv7()', 'gen_random_uuid()'),
    );
    await pg.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../../app/src/db/migrations/0038_trial_load_test_budget.sql',
        ),
        'utf8',
      ),
    );
    await pg.exec(
      entitlementStatementsOf0039(
        resolve(
          __dirname,
          '../../../../app/src/db/migrations/0039_trial_review_hardening.sql',
        ),
      ),
    );
    service = new ExecutionAdmissionService(
      drizzle(pg, { schema }) as unknown as PostgresJsDatabase<typeof schema>,
    );
  });

  afterAll(async () => {
    if (original === undefined)
      Reflect.deleteProperty(process.env, 'SELF_HOSTED');
    else process.env.SELF_HOSTED = original;
    await pg.close();
  });

  beforeEach(async () => {
    process.env.SELF_HOSTED = 'false';
    await pg.exec(
      'TRUNCATE execution_reservations, execution_entitlements, organization CASCADE',
    );
    await pg.query(
      'INSERT INTO organization (id, name, created_at) VALUES ($1, $2, now())',
      [orgId, 'Trial organization'],
    );
    await pg.query(
      `INSERT INTO execution_entitlements (organization_id, expires_at, running_capacity)
       VALUES ($1, now() + interval '1 hour', 1)`,
      [orgId],
    );
  });

  it('blocks a second run while the first holds a live lease', async () => {
    await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await expect(
      service.reserve(orgId, 'run-2', 'playwright', 60_000),
    ).rejects.toBeInstanceOf(ExecutionCapacityError);
    expect(await reservations()).toHaveLength(1);
  });

  it('stops counting a crashed worker once its lease lapses', async () => {
    await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await expireLeases();
    await expect(
      service.reserve(orgId, 'run-2', 'playwright', 60_000),
    ).resolves.toMatchObject({ runId: 'run-2' });
  });

  it('lets a retry of the same run take over a lapsed reservation, fencing the old owner', async () => {
    const stale = await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await expireLeases();
    const retry = await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    expect(retry?.ownerToken).not.toBe(stale?.ownerToken);

    // The revived original worker must neither charge nor release the new run.
    await service.finish(stale!, 50_000);
    expect(await playwrightUsedMs()).toBe(0);
    expect((await reservations())[0].finished_at).toBeNull();

    await service.finish(retry!, 20_000);
    expect(await playwrightUsedMs()).toBe(20_000);
    expect((await reservations())[0].finished_at).not.toBeNull();
  });

  it('refuses to share a run id while the current owner still holds a live lease', async () => {
    await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await expect(
      service.reserve(orgId, 'run-1', 'playwright', 60_000),
    ).rejects.toBeInstanceOf(ExecutionCapacityError);
  });

  it('frees capacity immediately when a run finishes normally', async () => {
    const first = await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await service.finish(first!, 10_000);
    await expect(
      service.reserve(orgId, 'run-2', 'playwright', 60_000),
    ).resolves.toMatchObject({ runId: 'run-2' });
    expect(await playwrightUsedMs()).toBe(10_000);
  });

  it('never charges more than the reservation', async () => {
    const reservation = await service.reserve(
      orgId,
      'run-1',
      'playwright',
      30_000,
    );
    await service.finish(reservation!, 900_000);
    expect(await playwrightUsedMs()).toBe(30_000);
  });

  it('charges a crashed trial run for the time its lease was alive, and frees it for good', async () => {
    await service.reserve(orgId, 'run-1', 'playwright', 60_000);
    await pg.exec(
      "UPDATE execution_reservations SET started_at = now() - interval '20 minutes', lease_expires_at = now() - interval '7 minutes'",
    );
    await service.reserve(orgId, 'run-2', 'playwright', 60_000);
    // alive for 3 minutes but only 60 s were reserved
    expect(await playwrightUsedMs()).toBe(60_000);
    const [crashed] = (await reservations()).filter(
      (r) => r.run_id === 'run-1',
    );
    expect(crashed.finished_at).not.toBeNull();
  });

  it("counts a crashed run's charge before granting the next reservation", async () => {
    await pg.exec(
      'UPDATE execution_entitlements SET playwright_budget_ms = 100000',
    );
    await service.reserve(orgId, 'run-1', 'playwright', 100_000);
    await pg.exec(
      "UPDATE execution_reservations SET started_at = now() - interval '20 minutes', lease_expires_at = now() - interval '4 minutes'",
    ); // alive 11 min, reserved 100 s: charged the full 100 s
    await expect(
      service.reserve(orgId, 'run-2', 'playwright', 100_000),
    ).rejects.toBeInstanceOf(ExecutionEntitlementError); // nothing is left
  });

  it('charges a crashed run only for the time up to its last renewal, not the trailing lease', async () => {
    await service.reserve(orgId, 'run-1', 'playwright', 600_000);
    // started 20 min ago; last renewed 14 min ago, so the lease ran out 9 min ago
    await pg.exec(
      "UPDATE execution_reservations SET started_at = now() - interval '20 minutes', lease_expires_at = now() - interval '9 minutes'",
    );
    await service.reserve(orgId, 'run-2', 'playwright', 60_000);
    expect(await playwrightUsedMs()).toBe(6 * 60_000);
  });

  it('prunes finished and long-abandoned reservations, keeping recent ones', async () => {
    await pg.query(
      `INSERT INTO execution_reservations (run_id, organization_id, kind, tier, reserved_ms, owner_token, started_at, finished_at, lease_expires_at)
       VALUES ('finished-old', $1, 'playwright', 'trial', 1000, gen_random_uuid(), now() - interval '9 days', now() - interval '8 days', now() - interval '8 days'),
              ('abandoned-old', $1, 'playwright', 'trial', 1000, gen_random_uuid(), now() - interval '9 days', NULL, now() - interval '8 days'),
              ('finished-recent', $1, 'playwright', 'trial', 1000, gen_random_uuid(), now() - interval '1 hour', now() - interval '30 minutes', now() - interval '30 minutes')`,
      [orgId],
    );
    await service.reserve(orgId, 'run-new', 'playwright', 60_000);
    expect((await reservations()).map((r) => r.run_id)).toEqual([
      'finished-recent',
      'run-new',
    ]);
  });

  it('meters a limited load test in VU-milliseconds against the allowance', async () => {
    await pg.exec('UPDATE execution_entitlements SET k6_budget_vu_ms = 100000');
    const first = await service.reserve(orgId, 'k6-1', 'k6', 60_000);
    await service.setK6Workload(first!, 2, 30_000); // 60 000 VU-ms
    await service.finish(first!, 30_000);
    expect(
      Number(
        (
          await pg.query<{ used: string }>(
            'SELECT k6_used_vu_ms AS used FROM execution_entitlements',
          )
        ).rows[0].used,
      ),
    ).toBe(60_000);

    const second = await service.reserve(orgId, 'k6-2', 'k6', 60_000);
    await expect(
      service.setK6Workload(second!, 2, 30_000),
    ).rejects.toBeInstanceOf(ExecutionEntitlementError);
    await expect(
      service.setK6Workload(second!, 1, 30_000),
    ).resolves.toBeUndefined();
  });

  it('refuses to start a load test whose reservation lapsed, instead of running it unmetered', async () => {
    const reservation = await service.reserve(orgId, 'k6-1', 'k6', 60_000);
    await expireLeases();
    await expect(
      service.setK6Workload(reservation!, 1, 30_000),
    ).rejects.toBeInstanceOf(ExecutionCapacityError);
  });

  it('starts a retried run with no VUs carried over from its previous attempt', async () => {
    const first = await service.reserve(orgId, 'k6-1', 'k6', 60_000);
    await service.setK6Workload(first!, 5, 30_000);
    await service.finish(first!, 1_000);
    await service.reserve(orgId, 'k6-1', 'k6', 60_000);
    expect(
      (
        await pg.query<{ vus: number }>(
          "SELECT vus FROM execution_reservations WHERE run_id = 'k6-1'",
        )
      ).rows[0].vus,
    ).toBe(0);
  });

  it('settles reservations held by this process at shutdown so capacity is not blocked', async () => {
    let release!: () => void;
    const running = service.run(
      orgId,
      'run-1',
      'playwright',
      60_000,
      async () => {
        await new Promise<void>((resolveRun) => (release = resolveRun));
        return {};
      },
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    await service.onApplicationShutdown();
    expect((await reservations())[0].finished_at).not.toBeNull();
    await expect(
      service.reserve(orgId, 'run-2', 'playwright', 60_000),
    ).resolves.toMatchObject({ runId: 'run-2' });
    release();
    await running;
  });
});

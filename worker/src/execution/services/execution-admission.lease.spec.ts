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
} from './execution-admission.service';

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
});

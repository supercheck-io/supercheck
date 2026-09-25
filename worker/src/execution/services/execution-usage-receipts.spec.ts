import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres = require('postgres');
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';
import {
  drizzle as drizzlePostgres,
  PostgresJsDatabase,
} from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import { UsageTrackerService } from './usage-tracker.service';
import {
  persistExecutionReceipt,
  ExecutionUsageCompletion,
  ExecutionUsageTransaction,
} from './execution-usage-receipts';

jest.setTimeout(60_000);

const postgresUrl = process.env.EXECUTION_USAGE_TEST_DATABASE_URL;
const engines = postgresUrl ? ['embedded', 'postgres'] : ['embedded'];

describe.each(engines)('durable execution usage (%s)', (engine) => {
  let pg: {
    exec: (query: string) => Promise<unknown>;
    query: <T>(query: string, parameters?: string[]) => Promise<{ rows: T[] }>;
    close: () => Promise<void>;
  };
  let database: PostgresJsDatabase<typeof schema>;
  const orgId = '00000000-0000-4000-8000-000000000001';
  const runId = '00000000-0000-4000-8000-000000000002';
  const originalToken = process.env.POLAR_ACCESS_TOKEN;
  const originalMode = process.env.SELF_HOSTED;
  const completion: ExecutionUsageCompletion = {
    organizationId: orgId,
    runId,
    eventType: 'playwright_execution',
    durationMs: 61000,
    metadata: { type: 'single_test' },
  };
  const persistResult = async (tx: ExecutionUsageTransaction) => {
    await tx.execute(
      sql`UPDATE runs SET status = 'passed' WHERE id = ${runId}::uuid`,
    );
  };

  beforeAll(async () => {
    if (engine === 'postgres') {
      // Every connection is confined to a new random schema. Never truncate or
      // drop objects in public or reuse an existing application schema.
      const testSchema = `usage_test_${randomUUID().replaceAll('-', '')}`;
      const admin = postgres(postgresUrl!, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE SCHEMA "${testSchema}"`);
      const client = postgres(postgresUrl!, {
        max: 4,
        connection: { search_path: testSchema },
        onnotice: () => {},
      });
      database = drizzlePostgres(client, { schema });
      pg = {
        exec: (query) => client.unsafe(query).simple(),
        query: async <T>(query: string, parameters: string[] = []) => ({
          rows: Array.from(await client.unsafe(query, parameters)) as T[],
        }),
        close: async () => {
          await client.end();
          await admin.unsafe(`DROP SCHEMA "${testSchema}" CASCADE`);
          await admin.end();
        },
      };
    } else {
      const embedded = new PGlite();
      pg = embedded;
      database = drizzle(embedded, { schema }) as unknown as PostgresJsDatabase<
        typeof schema
      >;
    }
    // Existing tables are projected from the shipped schema; the new table is
    // created using the actual migration so constraints and SQL are exercised.
    for (const table of [
      schema.organization,
      schema.usageEvents,
    ] as PgTable[]) {
      const { name, columns } = getTableConfig(table);
      const definitions = columns.map(
        (column) =>
          `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}`,
      );
      await pg.exec(`CREATE TABLE "${name}" (${definitions.join(', ')})`);
    }
    await pg.exec('CREATE TABLE runs (id uuid PRIMARY KEY, status text)');
    await pg.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../../app/src/db/migrations/0024_execution_usage_receipts.sql',
        ),
        'utf8',
      ),
    );
  });

  beforeEach(async () => {
    process.env.SELF_HOSTED = 'false';
    process.env.POLAR_ACCESS_TOKEN = 'test-token';
    await pg.exec(
      'DROP TRIGGER IF EXISTS reject_usage ON usage_events; TRUNCATE execution_usage_receipts, usage_events, runs, organization CASCADE',
    );
    await database.insert(schema.organization).values({
      id: orgId,
      name: 'Test organization',
      createdAt: new Date(),
      usagePeriodStart: new Date(Date.now() - 86_400_000),
      usagePeriodEnd: new Date(Date.now() + 86_400_000),
      playwrightMinutesUsed: 0,
      k6VuMinutesUsed: 0,
    });
    await pg.query('INSERT INTO runs (id, status) VALUES ($1, $2)', [
      runId,
      'running',
    ]);
  });

  afterAll(async () => {
    if (originalToken === undefined) delete process.env.POLAR_ACCESS_TOKEN;
    else process.env.POLAR_ACCESS_TOKEN = originalToken;
    if (originalMode === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalMode;
    await pg?.close();
  });

  async function snapshot() {
    return {
      receipts: await database.select().from(schema.executionUsageReceipts),
      events: await database.select().from(schema.usageEvents),
      org: (await database.select().from(schema.organization))[0],
      status: (await pg.query<{ status: string }>('SELECT status FROM runs'))
        .rows[0].status,
    };
  }

  it('recovers after worker loss between completion commit and settlement, exactly once', async () => {
    const id = await persistExecutionReceipt(
      database,
      completion,
      persistResult,
    );
    expect(await snapshot()).toMatchObject({
      status: 'passed',
      events: [],
      receipts: [{ id, units: '1.0167', settledAt: null }],
    });

    const restarted = new UsageTrackerService(database);
    expect(await restarted.reconcilePendingExecutionUsage()).toBe(1);
    await new UsageTrackerService(database).reconcilePendingExecutionUsage();
    await restarted.trackPlaywrightExecution(orgId, 120000, { runId });
    const state = await snapshot();
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      id,
      units: '1.0167',
      metadata: { runId },
    });
    expect(state.org.playwrightMinutesUsed).toBe(1.0167);
    expect(state.receipts[0].settledAt).toBeInstanceOf(Date);
  });

  it('rolls back the receipt when the completed result cannot be saved', async () => {
    await expect(
      persistExecutionReceipt(database, completion, async (tx) => {
        await persistResult(tx);
        throw new Error('result persistence failed');
      }),
    ).rejects.toThrow('result persistence failed');
    expect(await snapshot()).toMatchObject({
      status: 'running',
      receipts: [],
      events: [],
    });
  });

  it('keeps completion durable and rolls back counters when the ledger insert fails', async () => {
    await pg.exec(`CREATE OR REPLACE FUNCTION reject_usage_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger unavailable'; END $$;
      CREATE TRIGGER reject_usage BEFORE INSERT ON usage_events FOR EACH ROW EXECUTE FUNCTION reject_usage_insert()`);
    const service = new UsageTrackerService(database);
    await service.completeRunWithUsage(completion, persistResult);
    let state = await snapshot();
    expect(state.status).toBe('passed');
    expect(state.events).toHaveLength(0);
    expect(state.org.playwrightMinutesUsed).toBe(0);
    expect(state.receipts[0].settledAt).toBeNull();
    expect(state.receipts[0].lastError).toBeTruthy();

    await pg.exec('DROP TRIGGER reject_usage ON usage_events');
    await database
      .update(schema.executionUsageReceipts)
      .set({ nextAttemptAt: new Date(0) });
    await new UsageTrackerService(database).reconcilePendingExecutionUsage();
    state = await snapshot();
    expect(state.org.playwrightMinutesUsed).toBe(1.0167);
    expect(state.events).toHaveLength(1);
    expect(state.receipts[0].lastError).toBeNull();
  });

  it('retains the original K6 amount on duplicate completion', async () => {
    const input = {
      ...completion,
      eventType: 'k6_execution' as const,
      virtualUsers: 10,
      durationMs: 61000,
    };
    const service = new UsageTrackerService(database);
    await service.completeRunWithUsage(input, persistResult);
    await service.completeRunWithUsage(
      { ...input, virtualUsers: 100 },
      persistResult,
    );
    const state = await snapshot();
    expect(state.receipts).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].units).toBe('11.0000');
    expect(state.org.k6VuMinutesUsed).toBe(11);
  });

  it('holds old-period receipts for review instead of charging the new period', async () => {
    await persistExecutionReceipt(database, completion, persistResult);
    await database
      .update(schema.organization)
      .set({ usagePeriodStart: new Date(), playwrightMinutesUsed: 0 })
      .where(eq(schema.organization.id, orgId));
    const service = new UsageTrackerService(database);
    await service.reconcilePendingExecutionUsage();
    await service.trackPlaywrightExecution(orgId, 61000, { runId });
    const state = await snapshot();
    expect(state.events).toHaveLength(0);
    expect(state.org.playwrightMinutesUsed).toBe(0);
    expect(state.receipts[0].nextAttemptAt).toBeNull();
    expect(state.receipts[0].lastError).toContain('manual reconciliation');
  });

  it('holds receipts when the period end changes without a new start', async () => {
    await persistExecutionReceipt(database, completion, persistResult);
    await database
      .update(schema.organization)
      .set({ usagePeriodEnd: new Date(Date.now() + 172_800_000) });
    await new UsageTrackerService(database).reconcilePendingExecutionUsage();
    const state = await snapshot();
    expect(state.events).toHaveLength(0);
    expect(state.receipts[0].nextAttemptAt).toBeNull();
    expect(state.receipts[0].lastError).toContain('manual reconciliation');
  });

  if (engine === 'postgres') {
    it('serializes simultaneous settlement on independent PostgreSQL connections', async () => {
      await persistExecutionReceipt(database, completion, persistResult);
      await Promise.all(
        Array.from({ length: 4 }, () =>
          new UsageTrackerService(database).reconcilePendingExecutionUsage(),
        ),
      );
      const state = await snapshot();
      expect(state.events).toHaveLength(1);
      expect(state.org.playwrightMinutesUsed).toBe(1.0167);
      expect(state.receipts[0].settledAt).toBeInstanceOf(Date);
    });

    it('serializes duplicate completions while preserving the first amount', async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          new UsageTrackerService(database).completeRunWithUsage(
            completion,
            persistResult,
          ),
        ),
      );
      const state = await snapshot();
      expect(state.receipts).toHaveLength(1);
      expect(state.events).toHaveLength(1);
      expect(state.org.playwrightMinutesUsed).toBe(1.0167);
    });
  }

  it('does not scan historical completed runs without a receipt', async () => {
    await pg.exec("UPDATE runs SET status = 'passed'");
    expect(
      await new UsageTrackerService(database).reconcilePendingExecutionUsage(),
    ).toBe(0);
    expect((await snapshot()).events).toHaveLength(0);
  });

  it('settles a receipt without charging again when an older worker already wrote the ledger', async () => {
    const service = new UsageTrackerService(database);
    await service.trackPlaywrightExecution(orgId, 61000, { runId });
    await service.completeRunWithUsage(completion, persistResult);
    const state = await snapshot();
    expect(state.events).toHaveLength(1);
    expect(state.org.playwrightMinutesUsed).toBe(1.0167);
    expect(state.receipts[0].settledAt).toBeInstanceOf(Date);
  });

  it('keeps the same run key independent across organizations', async () => {
    const otherOrgId = '00000000-0000-4000-8000-000000000003';
    await database.insert(schema.organization).values({
      id: otherOrgId,
      name: 'Other organization',
      createdAt: new Date(),
      usagePeriodStart: new Date(Date.now() - 86_400_000),
      usagePeriodEnd: new Date(Date.now() + 86_400_000),
      playwrightMinutesUsed: 0,
    });
    const service = new UsageTrackerService(database);
    await service.completeRunWithUsage(completion, persistResult);
    await service.completeRunWithUsage(
      { ...completion, organizationId: otherOrgId, durationMs: 120000 },
      async () => {},
    );
    const state = await snapshot();
    expect(state.events).toHaveLength(2);
    expect(state.receipts).toHaveLength(2);
    const organizations = await database.select().from(schema.organization);
    expect(
      organizations.find((org) => org.id === orgId)?.playwrightMinutesUsed,
    ).toBe(1.0167);
    expect(
      organizations.find((org) => org.id === otherOrgId)?.playwrightMinutesUsed,
    ).toBe(2);
  });

  it.each(['true', '1'])(
    'keeps self-hosted %s completion independent of receipts',
    async (mode) => {
      process.env.SELF_HOSTED = mode;
      const service = new UsageTrackerService(database);
      await service.completeRunWithUsage(completion, persistResult);
      await service.trackPlaywrightExecution(orgId, 61000, { runId });
      const state = await snapshot();
      expect(state).toMatchObject({
        status: 'passed',
        receipts: [],
        events: [],
      });
      expect(state.org.playwrightMinutesUsed).toBe(1.0167);
    },
  );
});

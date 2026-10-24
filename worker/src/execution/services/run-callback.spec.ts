import { AsyncResource } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres = require('postgres');
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  drizzle as drizzlePostgres,
  PostgresJsDatabase,
} from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DbService } from './db.service';
import {
  withRunCallback,
  writeRunArtifact,
  RunCallbackBusyError,
  lockRecoverableRunCallbacks,
  canPersistK6Result,
} from './run-callback';

jest.setTimeout(60_000);
const url = process.env.EXECUTION_USAGE_TEST_DATABASE_URL;
const engines = url ? ['embedded', 'postgres'] : ['embedded'];
const migration = readFileSync(
  resolve(
    __dirname,
    '../../../../app/src/db/migrations/0040_run_callback_fencing.sql',
  ),
  'utf8',
);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe.each(engines)('whole callback fencing (%s)', (engine) => {
  let db: PostgresJsDatabase<typeof schema>;
  let exec: (query: string) => Promise<unknown>;
  let close: () => Promise<void>;
  const runId = '00000000-0000-4000-8000-000000000001';
  const otherId = '00000000-0000-4000-8000-000000000002';
  beforeAll(async () => {
    if (engine === 'postgres') {
      const name = `callback_test_${randomUUID().replaceAll('-', '')}`;
      const admin = postgres(url!, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE SCHEMA "${name}"`);
      const client = postgres(url!, {
        max: 4,
        connection: { search_path: name },
        onnotice: () => {},
      });
      db = drizzlePostgres(client, { schema });
      exec = (query) => client.unsafe(query).simple();
      close = async () => {
        await client.end();
        await admin.unsafe(`DROP SCHEMA "${name}" CASCADE`);
        await admin.end();
      };
    } else {
      const pg = new PGlite();
      db = drizzle(pg, { schema }) as unknown as PostgresJsDatabase<
        typeof schema
      >;
      exec = (query) => pg.exec(query);
      close = () => pg.close();
    }
    await exec(`CREATE FUNCTION uuidv7() RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
      CREATE TABLE organization (id uuid PRIMARY KEY);
      CREATE TABLE projects (id uuid PRIMARY KEY, organization_id uuid REFERENCES organization(id) ON DELETE CASCADE);
      CREATE TABLE jobs (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id) ON DELETE CASCADE);
      CREATE TABLE runs (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id) ON DELETE CASCADE, job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
        status text, completed_at timestamp, error_details text);
      CREATE TABLE reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
        created_by_user_id uuid, entity_type varchar(50), entity_id text, report_path varchar(255),
        status varchar(50), s3_url varchar(1024), created_at timestamp, updated_at timestamp,
        UNIQUE(entity_type,entity_id));`);
    await exec(migration);
    await exec(migration); // The trigger/table migration is retry-safe.
  });
  afterAll(async () => {
    await close?.();
  });
  beforeEach(async () => {
    await exec(`TRUNCATE reports, run_callbacks, runs, jobs, projects, organization CASCADE;
      INSERT INTO runs (id,status) VALUES ('${runId}','running'), ('${otherId}','running');`);
  });
  const metadata = (id = runId) => ({
    entityId: id,
    entityType: 'test' as const,
    reportPath: `${id}/report`,
    status: 'passed' as const,
  });

  it('keeps a paused upload alive after queue/pod loss and prevents duplicate promotion', async () => {
    const entered = deferred();
    const release = deferred();
    const callback = withRunCallback(db, runId, async () => {
      await writeRunArtifact(
        'tests',
        `${runId}/report/index.html`,
        async () => {
          entered.resolve();
          await release.promise;
        },
      );
      await new DbService(db, {} as never).storeReportMetadata(metadata());
    });
    await entered.promise;
    try {
      expect(
        await db.transaction((tx) => lockRecoverableRunCallbacks(tx, [runId])),
      ).toEqual([]);
      await expect(
        withRunCallback(db, runId, async () => {}),
      ).rejects.toBeInstanceOf(RunCallbackBusyError);
    } finally {
      release.resolve();
      await callback;
    }
    expect(await db.select().from(schema.reports)).toHaveLength(1);
  });

  it('fences a stale callback, preserves its prefix on deletion, and rejects late metadata', async () => {
    const entered = deferred();
    const release = deferred();
    const callback = withRunCallback(db, runId, async () => {
      await writeRunArtifact(
        'tests',
        `${runId}/report/index.html`,
        async () => {
          entered.resolve();
          await release.promise;
        },
      );
      await new DbService(db, {} as never).storeReportMetadata(metadata());
      await expect(
        writeRunArtifact('tests', `${runId}/report/late`, async () => {}),
      ).rejects.toThrow('fenced');
    });
    await entered.promise;
    try {
      await db.execute(
        sql`UPDATE run_callbacks SET heartbeat_at = now() - interval '3 minutes'`,
      );
      expect(
        await db.transaction((tx) => lockRecoverableRunCallbacks(tx, [runId])),
      ).toEqual([runId]);
      await db.delete(schema.runs).where(eq(schema.runs.id, runId));
    } finally {
      release.resolve();
      await callback;
    }
    const [tombstone] = await db.select().from(schema.runCallbacks);
    expect(tombstone.bucket).toBe('tests');
    expect(tombstone.cleanupAt).toBeInstanceOf(Date);
    expect(await db.select().from(schema.reports)).toHaveLength(0);
  });

  it('retains cleanup intent after rejection, completion, and a later external commit', async () => {
    const remoteObjects = new Set<string>();
    let remoteCommit = () => {};
    await withRunCallback(db, runId, async () => {
      await expect(
        writeRunArtifact('tests', `${runId}/report/index.html`, async () => {
          remoteCommit = () => remoteObjects.add(`${runId}/report/index.html`);
          throw new Error('connection lost after send');
        }),
      ).rejects.toThrow('connection lost');
    });
    await db.delete(schema.runs).where(eq(schema.runs.id, runId));
    remoteObjects.clear(); // First cleanup can see an empty prefix.
    remoteCommit();
    const [pointer] = await db.select().from(schema.runCallbacks);
    expect(pointer.finishedAt).toBeInstanceOf(Date);
    expect(pointer.cleanupAt).toBeInstanceOf(Date);
    expect(remoteObjects.has(`${pointer.runId}/report/index.html`)).toBe(true);
    // A subsequent cleanup retains the same immutable pointer.
    remoteObjects.clear();
    expect(await db.select().from(schema.runCallbacks)).toHaveLength(1);
  });

  it('retains sent targets even when SDK retries ultimately ACK', async () => {
    await withRunCallback(db, runId, () =>
      writeRunArtifact(
        'tests',
        `${runId}/report/index.html`,
        async () => 'ack',
      ),
    );
    await db.delete(schema.runs).where(eq(schema.runs.id, runId));
    expect((await db.select().from(schema.runCallbacks))[0].bucket).toBe(
      'tests',
    );
  });

  it('rejects shared test directories and bucket changes before sending', async () => {
    const send = jest.fn();
    await withRunCallback(db, runId, async () => {
      await expect(
        writeRunArtifact('tests', 'saved-test/report/index.html', send),
      ).rejects.toThrow('namespace');
      await writeRunArtifact('tests', `${runId}/report/index.html`, send);
      await expect(
        writeRunArtifact('jobs', `${runId}/report/index.html`, send),
      ).rejects.toThrow('bucket changed');
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps two runs of the same saved test independent during destructive cleanup', async () => {
    const objects = new Set<string>();
    for (const id of [runId, otherId])
      await withRunCallback(db, id, async () => {
        await writeRunArtifact('tests', `${id}/report/index.html`, async () => {
          objects.add(`${id}/report/index.html`);
        });
        await new DbService(db, {} as never).storeReportMetadata(metadata(id));
      });
    await db.delete(schema.runs).where(eq(schema.runs.id, runId));
    const [pointer] = await db
      .select()
      .from(schema.runCallbacks)
      .where(eq(schema.runCallbacks.runId, runId));
    for (const key of objects)
      if (key.startsWith(`${pointer.runId}/`)) objects.delete(key);
    expect([...objects]).toEqual([`${otherId}/report/index.html`]);
    expect(
      (
        await db
          .select()
          .from(schema.runCallbacks)
          .where(eq(schema.runCallbacks.runId, otherId))
      )[0].cleanupAt,
    ).toBeNull();
  });

  it('records cleanup intent on parent cascade even after callback death', async () => {
    await exec(`INSERT INTO jobs (id) VALUES ('${otherId}'); UPDATE runs SET job_id='${otherId}' WHERE id='${runId}';
      INSERT INTO run_callbacks (run_id,owner,bucket) VALUES ('${runId}','${otherId}','tests');
      DELETE FROM jobs WHERE id='${otherId}';`);
    expect(
      (await db.select().from(schema.runCallbacks))[0].cleanupAt,
    ).toBeInstanceOf(Date);
  });

  it('drains unawaited writes before completing and rejects writes after return', async () => {
    const entered = deferred();
    const release = deferred();
    let late!: () => Promise<unknown>;
    let settled = false;
    const callback = withRunCallback(db, runId, async () => {
      const pending = writeRunArtifact(
        'tests',
        `${runId}/report/index.html`,
        async () => {
          entered.resolve();
          await release.promise;
        },
      );
      late = AsyncResource.bind(() =>
        writeRunArtifact('tests', `${runId}/report/late`, async () => {}),
      );
      // Wait until the fire-and-forget write has actually been sent.
      await entered.promise;
      void pending;
    }).then(() => {
      settled = true;
    });
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release.resolve();
    await callback;
    await expect(late()).rejects.toThrow('active run namespace');
  });

  it('persists the recovered result after a transient heartbeat query failure', async () => {
    let tick!: () => void;
    const interval = jest.spyOn(global, 'setInterval').mockImplementation(((
      fn: () => void,
    ) => {
      tick = fn;
      return { unref() {} };
    }) as never);
    const originalUpdate = db.update.bind(db);
    const update = jest
      .spyOn(db, 'update')
      .mockImplementationOnce(
        () =>
          ({
            set: () => ({
              where: () => ({
                returning: () =>
                  Promise.reject(new Error('transient database error')),
              }),
            }),
          }) as never,
      )
      .mockImplementation(originalUpdate);
    try {
      await withRunCallback(db, runId, async () => {
        tick();
        await new Promise((resolve) => setImmediate(resolve));
        await new DbService(db, {} as never).storeReportMetadata(metadata());
      });
      expect(await db.select().from(schema.reports)).toHaveLength(1);
    } finally {
      interval.mockRestore();
      update.mockRestore();
    }
  });

  it('atomically maintains legacy test aliases without sharing the run directory', async () => {
    for (const id of [runId, otherId])
      await withRunCallback(db, id, async () => {
        await new DbService(db, {} as never).storeReportMetadata({
          ...metadata(id),
          aliasEntityId: 'saved-test',
        });
      });
    const rows = await db.select().from(schema.reports);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.entityId === 'saved-test')?.reportPath).toBe(
      `${otherId}/report`,
    );
    expect(rows.find((row) => row.entityId === runId)?.reportPath).toBe(
      `${runId}/report`,
    );
  });

  (engine === 'postgres' ? it : it.skip).each(['job', 'organization'])(
    'locks K6 parents before the run during concurrent %s deletion',
    async (parent) => {
      await exec(`INSERT INTO organization VALUES ('${otherId}');
        INSERT INTO projects VALUES ('${otherId}','${otherId}');
        INSERT INTO jobs VALUES ('${otherId}','${otherId}');
        UPDATE runs SET job_id='${otherId}',project_id='${otherId}' WHERE id='${runId}';`);
      const callbackEntered = deferred();
      const parentLocked = deferred();
      const resultStarted = deferred();
      let allowed: boolean | undefined;
      const callback = withRunCallback(db, runId, async () => {
        callbackEntered.resolve();
        await parentLocked.promise;
        resultStarted.resolve();
        // No billing org lock: covers self-hosted and zero-billable completion too.
        allowed = await db.transaction((tx) =>
          canPersistK6Result(tx, otherId, otherId, otherId),
        );
      });
      await callbackEntered.promise;
      const deletion = db.transaction(async (tx) => {
        const table = parent === 'job' ? schema.jobs : schema.organization;
        await tx
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, otherId))
          .for('update');
        parentLocked.resolve();
        await resultStarted.promise;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await tx.delete(table).where(eq(table.id, otherId));
      });
      await Promise.all([callback, deletion]);
      expect(allowed).toBe(false);
      expect(
        (await db.select().from(schema.runCallbacks))[0].cleanupAt,
      ).toBeInstanceOf(Date);
    },
  );
});

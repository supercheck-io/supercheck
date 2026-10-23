import { randomUUID } from 'node:crypto';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../src/execution/services/db.service';
import { RUN_CANCELLATION_MARKER } from '../src/common/services/cancellation.service';
import { StalledJobHandlerService } from '../src/execution/services/stalled-job-handler.service';

jest.mock('execa', () => ({ execa: jest.fn() }));

const marker = RUN_CANCELLATION_MARKER;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let service: DbService;
const name = `cancel_admission_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL required');
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  client = postgres(url.toString(), { max: 2 });
  await client.unsafe(
    'CREATE TABLE runs (id uuid PRIMARY KEY, job_id uuid, status text, started_at timestamptz, created_at timestamptz, completed_at timestamptz, error_details text, location text, duration_ms integer)',
  );
  service = new DbService(drizzle(client), new ConfigService());
});
afterAll(async () => {
  await client?.end();
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
  }
});
async function seed(
  errorDetails: string | null = marker,
  status: 'queued' | 'running' = 'queued',
) {
  const id = randomUUID();
  await client`INSERT INTO runs(id,status,created_at,error_details) VALUES (${id},${status},now()-interval '3 hours',${errorDetails})`;
  return id;
}
function recovery(enabled: boolean, active = false) {
  const handler = new StalledJobHandlerService(
    service,
    new ConfigService({ CANCELLED_QUEUED_RECOVERY_ENABLED: String(enabled) }),
    { hasActiveExecution: async () => active } as never,
  );
  const state = handler as unknown as {
    redisClient: object;
    isBullMqJobActive: () => Promise<boolean>;
    checkAndHandleStalledJobs: () => Promise<void>;
  };
  state.redisClient = {};
  jest.spyOn(state, 'isBullMqJobActive').mockResolvedValue(false);
  return state;
}
it('lets cancellation win an execution claim blocked behind its transaction', async () => {
  const id = await seed(null);
  let claim!: Promise<boolean>;
  await client.begin(async (tx) => {
    await tx.unsafe('UPDATE runs SET error_details=$1 WHERE id=$2', [
      marker,
      id,
    ]);
    let settled = false;
    claim = service.claimRunExecution(id).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
  });
  expect(await claim).toBe(false);
  expect(
    await client`SELECT status, started_at FROM runs WHERE id=${id}`,
  ).toEqual([{ status: 'queued', started_at: null }]);
});
it('protects an admitted callback from queued cancellation recovery', async () => {
  const id = await seed(null);
  expect(await service.claimRunExecution(id)).toBe(true);
  await client`UPDATE runs SET error_details=${marker} WHERE id=${id}`;
  expect(await service.claimRunExecution(id)).toBe(false);
  await recovery(true).checkAndHandleStalledJobs();
  expect(await client`SELECT status FROM runs WHERE id=${id}`).toEqual([
    { status: 'running' },
  ]);
});
it('requires the protocol rollout gate and suppresses late promotion after queued recovery', async () => {
  const id = await seed();
  const ordinary = await seed(null);
  await recovery(false).checkAndHandleStalledJobs();
  expect(await client`SELECT status FROM runs WHERE id=${id}`).toEqual([
    { status: 'queued' },
  ]);
  await recovery(true).checkAndHandleStalledJobs();
  expect(await client`SELECT status FROM runs WHERE id=${id}`).toEqual([
    { status: 'error' },
  ]);
  expect(await service.claimRunExecution(id)).toBe(false);
  expect(await client`SELECT status FROM runs WHERE id=${ordinary}`).toEqual([
    { status: 'queued' },
  ]);
});
it('keeps a queued cancellation protected while execution activity is present', async () => {
  const id = await seed();
  await recovery(true, true).checkAndHandleStalledJobs();
  expect(await client`SELECT status FROM runs WHERE id=${id}`).toEqual([
    { status: 'queued' },
  ]);
});
it('ends a cancelled run whose execution claim was refused, even with recovery off', async () => {
  const id = await seed();
  const ordinary = await seed(null);
  expect(await service.claimRunExecution(id)).toBe(false);
  expect(await service.finalizeCancelledRun(id)).toBe(true);
  expect(await service.finalizeCancelledRun(id)).toBe(false);
  expect(await service.finalizeCancelledRun(ordinary)).toBe(false);
  expect(
    await client`SELECT status, completed_at IS NOT NULL AS done FROM runs WHERE id=${id}`,
  ).toEqual([{ status: 'error', done: true }]);
  expect(await client`SELECT status FROM runs WHERE id=${ordinary}`).toEqual([
    { status: 'queued' },
  ]);
});
it('lets a completed result replace a late cancellation marker', async () => {
  const id = await seed(null);
  expect(await service.claimRunExecution(id)).toBe(true);
  await client`UPDATE runs SET error_details=${marker} WHERE id=${id}`;
  await service.updateRunStatus(id, 'passed', '1');
  expect(
    await client`SELECT status, error_details FROM runs WHERE id=${id}`,
  ).toEqual([{ status: 'passed', error_details: null }]);
});
it('finishes a cancelled run that the app had already marked running, and leaves other runs alone', async () => {
  const cancelled = await seed(marker, 'running');
  const finished = await seed(null, 'running');
  expect(await service.claimRunExecution(cancelled)).toBe(false);
  expect(await service.finalizeCancelledRun(cancelled)).toBe(true);
  expect(await service.finalizeCancelledRun(finished)).toBe(false);
  expect(await client`SELECT status FROM runs WHERE id=${cancelled}`).toEqual([
    { status: 'error' },
  ]);
  expect(await client`SELECT status FROM runs WHERE id=${finished}`).toEqual([
    { status: 'running' },
  ]);
});
it('clears only the cancellation marker when a result completes, keeping any other detail', async () => {
  const withMarker = await seed(marker, 'running');
  const withDetail = await seed('Timed out waiting for the page', 'running');
  await service.updateRunStatus(withMarker, 'passed', '1');
  await service.updateRunStatus(withDetail, 'failed', '1');
  expect(
    await client`SELECT error_details FROM runs WHERE id=${withMarker}`,
  ).toEqual([{ error_details: null }]);
  expect(
    await client`SELECT error_details FROM runs WHERE id=${withDetail}`,
  ).toEqual([{ error_details: 'Timed out waiting for the page' }]);
});
it('keeps the cancellation marker when the stalled sweep ends a cancelled run', async () => {
  const cancelled = await seed(marker, 'running');
  const stalled = await seed(null, 'running');
  await client`UPDATE runs SET started_at=now()-interval '3 hours' WHERE id IN (${cancelled}, ${stalled})`;
  await recovery(true).checkAndHandleStalledJobs();
  expect(
    await client`SELECT status, error_details FROM runs WHERE id=${cancelled}`,
  ).toEqual([{ status: 'error', error_details: marker }]);
  expect(
    await client`SELECT status, error_details FROM runs WHERE id=${stalled}`,
  ).toEqual([
    {
      status: 'error',
      error_details:
        'Execution timed out - marked as stalled by automatic recovery',
    },
  ]);
});

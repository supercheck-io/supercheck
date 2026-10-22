import { randomUUID } from 'node:crypto';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../src/execution/services/db.service';
import { StalledJobHandlerService } from '../src/execution/services/stalled-job-handler.service';

jest.mock('execa', () => ({ execa: jest.fn() }));

const marker = 'Cancellation requested by user';
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
    'CREATE TABLE runs (id uuid PRIMARY KEY, job_id uuid, status text, started_at timestamptz, created_at timestamptz, completed_at timestamptz, error_details text, location text)',
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
async function seed(errorDetails: string | null = marker) {
  const id = randomUUID();
  await client`INSERT INTO runs(id,status,created_at,error_details) VALUES (${id},'queued',now()-interval '3 hours',${errorDetails})`;
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

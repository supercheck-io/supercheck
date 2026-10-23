import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import {
  ExecutionAdmissionService,
  ExecutionCapacityError,
} from '../src/execution/services/execution-admission.service';

const name = `execution_admission_${randomUUID().replaceAll('-', '')}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let service: ExecutionAdmissionService;
const org = randomUUID();
const previousMode = process.env.SELF_HOSTED;
beforeAll(async () => {
  process.env.SELF_HOSTED = 'false';
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL required');
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  client = postgres(url.toString(), { max: 5 });
  await client.unsafe(`
    CREATE TABLE organization (id uuid PRIMARY KEY, polar_customer_id text, subscription_plan text, subscription_status text, subscription_ends_at timestamptz);
    CREATE TABLE plan_limits (plan text PRIMARY KEY, running_capacity integer NOT NULL);
  `);
  await client.unsafe(
    readFileSync(
      join(
        __dirname,
        '../../app/src/db/migrations/0037_execution_entitlements.sql',
      ),
      'utf8',
    ),
  );
  await client.unsafe(
    readFileSync(
      join(
        __dirname,
        '../../app/src/db/migrations/0038_trial_load_test_budget.sql',
      ),
      'utf8',
    ),
  );
  await client.unsafe(
    readFileSync(
      join(
        __dirname,
        '../../app/src/db/migrations/0039_trial_review_hardening.sql',
      ),
      'utf8',
    )
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
      .join('\n'),
  );
  await client`INSERT INTO organization(id) VALUES (${org})`;
  await client`INSERT INTO plan_limits VALUES ('plus',2),('pro',3)`;
  service = new ExecutionAdmissionService(drizzle(client, { schema }));
});
afterAll(async () => {
  if (previousMode === undefined) delete process.env.SELF_HOSTED;
  else process.env.SELF_HOSTED = previousMode;
  await client?.end();
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
  }
});
beforeEach(async () => {
  await client`DELETE FROM execution_reservations`;
  await client`UPDATE organization SET polar_customer_id=NULL, subscription_plan=NULL, subscription_status=NULL, subscription_ends_at=NULL`;
  await client`DELETE FROM execution_entitlements`;
  await client`INSERT INTO execution_entitlements VALUES (${org},now()+interval '1 hour',1,10,5,10000,0)`;
});
it('enforces the actual organization slot atomically across workers', async () => {
  const attempts = await Promise.allSettled([
    service.reserve(org, 'one', 'playwright', 10000),
    service.reserve(org, 'two', 'playwright', 10000),
  ]);
  expect(
    attempts.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = attempts.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(ExecutionCapacityError);
});
it('reserves only remaining allowance and returns unused time after the callback drains', async () => {
  const first = await service.reserve(org, 'one', 'playwright', 10000);
  expect(first?.reservedMs).toBe(10000);
  await service.finish(first!, 4000);
  const second = await service.reserve(org, 'two', 'playwright', 10000);
  expect(second?.reservedMs).toBe(6000);
  await service.finish(second!, 6000);
  await expect(
    service.reserve(org, 'three', 'playwright', 10000),
  ).rejects.toThrow('allowance');
});
it('does not let an expired entitlement or forged organization start work', async () => {
  await client`UPDATE execution_entitlements SET expires_at=now()-interval '1 second'`;
  await expect(
    service.reserve(org, 'expired', 'playwright', 1000),
  ).rejects.toThrow('entitlement');
  await expect(
    service.reserve(randomUUID(), 'foreign', 'playwright', 1000),
  ).rejects.toThrow('entitlement');
});
it('settles once and rejects stale owner settlement after retry admission', async () => {
  const first = await service.reserve(org, 'retry', 'playwright', 5000);
  await service.finish(first!, 1000);
  await service.finish(first!, 1000);
  const retry = await service.reserve(org, 'retry', 'playwright', 5000);
  await service.finish(first!, 5000);
  expect(
    await client`SELECT playwright_used_ms::integer AS used FROM execution_entitlements`,
  ).toEqual([{ used: 1000 }]);
  await service.finish(retry!, 2000);
  expect(
    await client`SELECT playwright_used_ms::integer AS used FROM execution_entitlements`,
  ).toEqual([{ used: 3000 }]);
});

it('uses the configured standard plan cap instead of a stale limited grant', async () => {
  await client`UPDATE organization SET polar_customer_id='customer', subscription_plan='plus', subscription_status='active' WHERE id=${org}`;
  const one = await service.reserve(org, 'standard-one', 'playwright', 10000);
  const two = await service.reserve(org, 'standard-two', 'k6', 10000);
  expect(one?.limited).toBe(false);
  expect(two?.limited).toBe(false);
  await expect(
    service.reserve(org, 'standard-three', 'playwright', 10000),
  ).rejects.toBeInstanceOf(ExecutionCapacityError);
  await service.finish(one!, 5000);
  expect(
    (await service.reserve(org, 'standard-three', 'playwright', 10000))
      ?.limited,
  ).toBe(false);
  expect(
    await client`SELECT playwright_used_ms::integer AS used FROM execution_entitlements`,
  ).toEqual([{ used: 0 }]);
});

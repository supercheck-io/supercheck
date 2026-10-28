import { randomUUID } from 'node:crypto';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { RUN_CANCELLATION_MARKER } from '../src/common/services/cancellation.service';
import { DbService } from '../src/execution/services/db.service';

it('orders terminal job history by timestamp, independently of UUIDv4 ordering', async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL required');
  const maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  const name = `streak_${randomUUID().replaceAll('-', '')}`;
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 1 });
  try {
    await client.unsafe(
      'CREATE TABLE runs (id uuid PRIMARY KEY, job_id uuid, status text, error_details text, created_at timestamp)',
    );
    const jobId = randomUUID();
    await client`INSERT INTO runs VALUES
      ('ffffffff-ffff-4fff-afff-ffffffffffff', ${jobId}, 'failed', null, '2026-01-01'),
      ('00000000-0000-4000-a000-000000000001', ${jobId}, 'passed', null, '2026-01-02'),
      ('00000000-0000-4000-a000-000000000002', ${jobId}, 'error', null, '2026-01-02'),
      ('dddddddd-dddd-4ddd-addd-dddddddddddd', ${jobId}, 'error', ${RUN_CANCELLATION_MARKER}, '2026-01-02 12:00'),
      ('eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', ${jobId}, 'running', null, '2026-01-03')`;
    const service = new DbService(drizzle(client), new ConfigService());
    const rows = await service.getRecentRunsForJob(jobId, 2);
    expect(rows.map((row) => row.id)).toEqual([
      '00000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000001',
    ]);
    expect(rows.map((row) => row.status)).toEqual(['error', 'passed']);
  } finally {
    await client.end();
    await maintenance.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await maintenance.end();
  }
}, 30000);

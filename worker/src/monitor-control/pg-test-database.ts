/**
 * Test helper: creates a throwaway database and applies the app's real migrations to it, so
 * monitor-cycle specs exercise the actual schema, constraints and partial indexes.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

export async function createTestDatabase(url: string) {
  const name = `monitor_cycles_${randomUUID().replaceAll('-', '')}`;
  const maintenance = postgres(url, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const appRoot = resolve(__dirname, '../../../app');
  execFileSync(process.execPath, [resolve(appRoot, 'scripts/db-migrate.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: target.toString(),
      SELF_HOSTED: 'true',
      NODE_ENV: 'test',
      NODE_PATH: resolve(__dirname, '../../node_modules'),
    },
    timeout: 100_000,
  });
  const client = postgres(target.toString(), { max: 8, onnotice: () => {} });
  return {
    client,
    db: drizzle(client, { schema }),
    async drop() {
      await client.end({ timeout: 5 });
      await maintenance.unsafe(
        `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
      );
      await maintenance.end({ timeout: 5 });
    },
  };
}

export async function seedMonitor(
  db: ReturnType<typeof drizzle<typeof schema>>,
  client: ReturnType<typeof postgres>,
) {
  await client`TRUNCATE monitors, organization CASCADE`;
  const [organization] = await db
    .insert(schema.organization)
    .values({ name: 'Org', createdAt: new Date() })
    .returning();
  const [monitor] = await db
    .insert(schema.monitors)
    .values({
      organizationId: organization.id,
      name: 'API',
      type: 'http_request',
      target: 'https://example.com',
      status: 'up',
      alertConfig: {
        enabled: true,
        notificationProviders: [],
        alertOnFailure: true,
        alertOnRecovery: true,
        failureThreshold: 1,
        recoveryThreshold: 1,
      } as never,
    })
    .returning();
  return { organizationId: organization.id, monitorId: monitor.id };
}

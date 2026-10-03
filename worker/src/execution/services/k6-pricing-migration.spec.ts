import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { overagePricing } from '../../db/schema';
import { UsageTrackerService } from './usage-tracker.service';

jest.setTimeout(60_000);

// This is a monorepo contract test: worker pricing must match the app-owned
// migration and seed. A standalone worker checkout must supply those fixtures.
const migration = readFileSync(
  resolve(
    __dirname,
    '../../../../app/src/db/migrations/0025_k6_volume_pricing.sql',
  ),
  'utf8',
);

describe('K6 volume pricing migration and seeding', () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE TABLE overage_pricing (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan text UNIQUE NOT NULL,
      playwright_minute_price_cents integer NOT NULL, k6_vu_minute_price_cents integer NOT NULL,
      ai_credit_price_cents integer NOT NULL, sre_investigation_unit_price_cents integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );`);
  });
  afterEach(async () => {
    await pg.close();
  });

  it('rejects standalone pricing seeding clearly before migration 0025', async () => {
    const client = async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.reduce(
        (text, part, index) => text + (index ? '$' + index : '') + part,
        '',
      );
      return (await pg.query(query, values)).rows;
    };
    const { seedOveragePricing } = require(
      resolve(__dirname, '../../../../app/scripts/db-seed.js'),
    );
    await expect(seedOveragePricing(client)).resolves.toBe(false);
    expect(
      (await pg.query('SELECT count(*)::int AS count FROM overage_pricing'))
        .rows,
    ).toEqual([{ count: 0 }]);
  });

  it('admits legacy pricing queries before migration and picks up the override afterward', async () => {
    await pg.exec(`INSERT INTO overage_pricing
      (plan, playwright_minute_price_cents, k6_vu_minute_price_cents, ai_credit_price_cents, sre_investigation_unit_price_cents)
      VALUES ('plus', 3, 1, 5, 50);`);
    const db = drizzle(pg, { schema: { overagePricing } });
    const service = new UsageTrackerService(db as never);
    const legacy = await service['getAdmissionPricing']('plus');
    expect(legacy?.k6VuMinutePriceCents).toBe(1);
    expect(legacy?.k6VuMinutePriceCentsOverride).toBeNull();
    await pg.exec(migration);
    expect(
      (await service['getAdmissionPricing']('plus'))
        ?.k6VuMinutePriceCentsOverride,
    ).toBe(0.5);
  });

  it('decodes stock fractional rates as numbers without changing legacy rates', async () => {
    await pg.exec(`INSERT INTO overage_pricing
      (plan, playwright_minute_price_cents, k6_vu_minute_price_cents, ai_credit_price_cents, sre_investigation_unit_price_cents)
      VALUES ('plus', 3, 1, 5, 50), ('pro', 2, 1, 3, 50);`);
    await pg.exec(migration);
    const prices = await drizzle(pg).select().from(overagePricing);
    expect(
      prices.map((row) => [
        row.plan,
        row.k6VuMinutePriceCents,
        row.k6VuMinutePriceCentsOverride,
      ]),
    ).toEqual([
      ['plus', 1, 0.5],
      ['pro', 1, 0.25],
    ]);
    // Routine seeding must not replace custom or already configured prices.
    await pg.exec(
      `UPDATE overage_pricing SET k6_vu_minute_price_cents_override = 0 WHERE plan = 'plus';`,
    );
    const client = async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.reduce(
        (text, part, index) => text + (index ? '$' + index : '') + part,
        '',
      );
      return (await pg.query(query, values)).rows;
    };
    const { seedOveragePricing } = require(
      resolve(__dirname, '../../../../app/scripts/db-seed.js'),
    ) as {
      seedOveragePricing: (connection: typeof client) => Promise<boolean>;
    };
    await expect(seedOveragePricing(client)).resolves.toBe(true);
    const preserved = await drizzle(pg).select().from(overagePricing);
    expect(
      preserved.find((row) => row.plan === 'plus')
        ?.k6VuMinutePriceCentsOverride,
    ).toBe(0);
  });

  it('preserves custom price configurations and seeds discounted missing plans', async () => {
    await pg.exec(`INSERT INTO overage_pricing
      (plan, playwright_minute_price_cents, k6_vu_minute_price_cents, ai_credit_price_cents, sre_investigation_unit_price_cents)
      VALUES ('plus', 4, 1, 5, 50);`);
    await pg.exec(migration);
    const client = async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const query = strings.reduce(
        (text, part, index) => text + (index ? '$' + index : '') + part,
        '',
      );
      return (await pg.query(query, values)).rows;
    };
    const { seedOveragePricing } = require(
      resolve(__dirname, '../../../../app/scripts/db-seed.js'),
    ) as {
      seedOveragePricing: (connection: typeof client) => Promise<boolean>;
    };
    await expect(seedOveragePricing(client)).resolves.toBe(true);
    const prices = await drizzle(pg).select().from(overagePricing);
    expect(prices.find((row) => row.plan === 'plus')).toMatchObject({
      playwrightMinutePriceCents: 4,
      k6VuMinutePriceCents: 1,
      k6VuMinutePriceCentsOverride: null,
    });
    expect(prices.find((row) => row.plan === 'pro')).toMatchObject({
      k6VuMinutePriceCents: 1,
      k6VuMinutePriceCentsOverride: 0.25,
    });
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { overagePricing } from '../../db/schema';

jest.setTimeout(60_000);
const readMigration = (name: string) =>
  readFileSync(
    resolve(__dirname, `../../../../app/src/db/migrations/${name}.sql`),
    'utf8',
  );
const stockPlans = [
  {
    plan: 'plus',
    max_monitors: 25,
    min_check_interval_minutes: 1,
    playwright_minutes_included: 3000,
    k6_vu_minutes_included: 20000,
    ai_credits_included: 100,
    sre_investigation_units_included: 25,
    running_capacity: 5,
    queued_capacity: 50,
    max_team_members: 5,
    max_organizations: 1,
    max_projects: 10,
    max_status_pages: 3,
    max_status_page_subscribers: 500,
    custom_domains: true,
    sso_enabled: true,
    data_retention_days: 7,
    aggregated_data_retention_days: 30,
    job_data_retention_days: 30,
  },
  {
    plan: 'pro',
    max_monitors: 100,
    min_check_interval_minutes: 1,
    playwright_minutes_included: 10000,
    k6_vu_minutes_included: 75000,
    ai_credits_included: 300,
    sre_investigation_units_included: 100,
    running_capacity: 10,
    queued_capacity: 100,
    max_team_members: 25,
    max_organizations: 1,
    max_projects: 50,
    max_status_pages: 15,
    max_status_page_subscribers: 5000,
    custom_domains: true,
    sso_enabled: true,
    data_retention_days: 7,
    aggregated_data_retention_days: 90,
    job_data_retention_days: 90,
  },
];

describe('competitive stock pricing rollout', () => {
  let pg: PGlite;
  beforeEach(async () => {
    pg = new PGlite();
    const columns = Object.entries(stockPlans[0])
      .map(
        ([key, value]) =>
          `${key} ${typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'text' : 'numeric'} NOT NULL`,
      )
      .join(', ');
    await pg.exec(`CREATE TABLE plan_limits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ${columns}, updated_at timestamp DEFAULT now());
      CREATE TABLE overage_pricing (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan text UNIQUE NOT NULL, playwright_minute_price_cents integer NOT NULL, k6_vu_minute_price_cents integer NOT NULL, k6_vu_minute_price_cents_override numeric(14,4), ai_credit_price_cents integer NOT NULL, sre_investigation_unit_price_cents integer NOT NULL, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      CREATE TABLE usage_events (units numeric); INSERT INTO usage_events VALUES (123.4567);
      INSERT INTO overage_pricing (plan, playwright_minute_price_cents, k6_vu_minute_price_cents, k6_vu_minute_price_cents_override, ai_credit_price_cents, sre_investigation_unit_price_cents) VALUES ('plus',3,1,.5,5,50),('pro',2,1,.25,3,50);`);
    for (const plan of stockPlans) {
      const keys = Object.keys(plan);
      await pg.query(
        `INSERT INTO plan_limits (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        Object.values(plan),
      );
    }
  });
  afterEach(async () => {
    await pg.close();
  });
  const migrate = async () => {
    await pg.exec(readMigration('0026_fractional_playwright_pricing'));
    await pg.exec(readMigration('0027_competitive_cloud_pricing'));
  };
  it('discounts both stock contracts, decodes half-cent rates, and keeps usage intact', async () => {
    await migrate();
    const prices = await drizzle(pg).select().from(overagePricing);
    expect(
      prices.map((p) => [
        p.plan,
        p.playwrightMinutePriceCents,
        p.k6VuMinutePriceCentsOverride,
        p.sreInvestigationUnitPriceCents,
      ]),
    ).toEqual([
      ['plus', 1, 0.2, 10],
      ['pro', 0.5, 0.1, 10],
    ]);
    const plans = (
      await pg.query<Record<string, string | number>>(
        'SELECT plan,max_monitors,k6_vu_minutes_included,ai_credits_included,sre_investigation_units_included,max_status_pages,max_status_page_subscribers FROM plan_limits ORDER BY plan',
      )
    ).rows;
    expect(
      plans.map((p) => Object.values(p).map((v, i) => (i ? Number(v) : v))),
    ).toEqual([
      ['plus', 50, 30000, 1000, 200, 5, 1000],
      ['pro', 200, 100000, 5000, 1000, 20, 10000],
    ]);
    expect(
      Number(
        (await pg.query<{ units: string }>('SELECT units FROM usage_events'))
          .rows[0].units,
      ),
    ).toBe(123.4567);
    await pg.exec(readMigration('0027_competitive_cloud_pricing'));
    expect(await drizzle(pg).select().from(overagePricing)).toEqual(prices);
  });
  it.each([
    "UPDATE plan_limits SET max_team_members=7 WHERE plan='plus'",
    "UPDATE overage_pricing SET k6_vu_minute_price_cents_override=0 WHERE plan='plus'",
    "UPDATE overage_pricing SET playwright_minute_price_cents=4 WHERE plan='plus'",
  ])('preserves the whole customized contract: %s', async (customize) => {
    await pg.exec(customize);
    const beforePlan = (
      await pg.query("SELECT * FROM plan_limits WHERE plan='plus'")
    ).rows;
    await pg.exec(readMigration('0026_fractional_playwright_pricing'));
    const beforePrice = await drizzle(pg).select().from(overagePricing);
    await pg.exec(readMigration('0027_competitive_cloud_pricing'));
    expect(
      (await pg.query("SELECT * FROM plan_limits WHERE plan='plus'")).rows,
    ).toEqual(beforePlan);
    expect(
      (await drizzle(pg).select().from(overagePricing)).find(
        (p) => p.plan === 'plus',
      ),
    ).toEqual(beforePrice.find((p) => p.plan === 'plus'));
    expect(
      (await drizzle(pg).select().from(overagePricing)).find(
        (p) => p.plan === 'pro',
      )?.playwrightMinutePriceCents,
    ).toBe(0.5);
  });
  describe('legacy organization-count repair', () => {
    const repair = () => pg.exec(readMigration('0028_legacy_stock_pricing'));
    beforeEach(async () => {
      await pg.exec(
        "UPDATE plan_limits SET max_organizations=CASE plan WHEN 'plus' THEN 2 ELSE 10 END",
      );
    });
    it('repairs skipped legacy stock contracts and is idempotent', async () => {
      await migrate();
      expect(
        (await drizzle(pg).select().from(overagePricing)).map(
          (p) => p.playwrightMinutePriceCents,
        ),
      ).toEqual([3, 2]);
      await repair();
      const plans = (
        await pg.query<Record<string, string | number>>(
          'SELECT * FROM plan_limits ORDER BY plan',
        )
      ).rows;
      const prices = await drizzle(pg).select().from(overagePricing);
      expect(
        prices.map((p) => [
          p.plan,
          p.playwrightMinutePriceCents,
          p.k6VuMinutePriceCentsOverride,
          p.sreInvestigationUnitPriceCents,
        ]),
      ).toEqual([
        ['plus', 1, 0.2, 10],
        ['pro', 0.5, 0.1, 10],
      ]);
      expect(
        plans.map((p) =>
          [
            'max_organizations',
            'max_monitors',
            'k6_vu_minutes_included',
            'ai_credits_included',
            'sre_investigation_units_included',
            'max_status_pages',
            'max_status_page_subscribers',
          ].map((k) => Number(p[k])),
        ),
      ).toEqual([
        [2, 50, 30000, 1000, 200, 5, 1000],
        [10, 200, 100000, 5000, 1000, 20, 10000],
      ]);
      expect(
        Number(
          (await pg.query<{ units: string }>('SELECT units FROM usage_events'))
            .rows[0].units,
        ),
      ).toBe(123.4567);
      await repair();
      expect(
        (
          await pg.query<Record<string, string | number>>(
            'SELECT * FROM plan_limits ORDER BY plan',
          )
        ).rows,
      ).toEqual(plans);
      expect(await drizzle(pg).select().from(overagePricing)).toEqual(prices);
    });
    it.each([
      "UPDATE plan_limits SET max_team_members=7 WHERE plan='plus'",
      "UPDATE plan_limits SET max_organizations=3 WHERE plan='plus'",
      "UPDATE overage_pricing SET k6_vu_minute_price_cents_override=0 WHERE plan='plus'",
      "UPDATE overage_pricing SET playwright_minute_price_cents=4 WHERE plan='plus'",
    ])('preserves customized legacy contracts: %s', async (customize) => {
      await pg.exec(customize);
      await migrate();
      const plan = (
        await pg.query("SELECT * FROM plan_limits WHERE plan='plus'")
      ).rows;
      const prices = await drizzle(pg).select().from(overagePricing);
      await repair();
      expect(
        (await pg.query("SELECT * FROM plan_limits WHERE plan='plus'")).rows,
      ).toEqual(plan);
      expect(
        (await drizzle(pg).select().from(overagePricing)).find(
          (p) => p.plan === 'plus',
        ),
      ).toEqual(prices.find((p) => p.plan === 'plus'));
      expect(
        (await drizzle(pg).select().from(overagePricing)).find(
          (p) => p.plan === 'pro',
        )?.playwrightMinutePriceCents,
      ).toBe(0.5);
    });
    it('rolls back both prices and limits when a plan update fails', async () => {
      await migrate();
      const plans = (await pg.query('SELECT * FROM plan_limits ORDER BY plan'))
        .rows;
      const prices = await drizzle(pg).select().from(overagePricing);
      await pg.exec(`CREATE FUNCTION reject_plan_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'blocked plan update'; END $$;
        CREATE TRIGGER reject_plan_update BEFORE UPDATE ON plan_limits
        FOR EACH ROW EXECUTE FUNCTION reject_plan_update();`);
      await expect(repair()).rejects.toThrow('blocked plan update');
      expect(
        (await pg.query('SELECT * FROM plan_limits ORDER BY plan')).rows,
      ).toEqual(plans);
      expect(await drizzle(pg).select().from(overagePricing)).toEqual(prices);
    });
    it('leaves already upgraded canonical contracts unchanged', async () => {
      await pg.exec('UPDATE plan_limits SET max_organizations=1');
      await migrate();
      const plans = (
        await pg.query<Record<string, string | number>>(
          'SELECT * FROM plan_limits ORDER BY plan',
        )
      ).rows;
      const prices = await drizzle(pg).select().from(overagePricing);
      await repair();
      expect(
        (
          await pg.query<Record<string, string | number>>(
            'SELECT * FROM plan_limits ORDER BY plan',
          )
        ).rows,
      ).toEqual(plans);
      expect(await drizzle(pg).select().from(overagePricing)).toEqual(prices);
    });
  });
});

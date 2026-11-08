/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). The plan catalog (public pricing source) must equal the
// plan_limits / overage_pricing rows the migrations leave behind, so a fresh install and the catalog never disagree.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import catalog from "./plan-catalog.json";

const name = `catalog_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 2, onnotice: () => {} });
  database = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

// Scope: a fresh install. An empty database is seeded from the catalog (the pricing migrations only update
// existing stock rows), so this guards seed and schema drift, not the upgrade path of already-priced rows.
describe.each(["plus", "pro"] as const)("%s catalog matches the migrated rows", (plan) => {
  it("plan limits", async () => {
    const [row] = await database.select().from(schema.planLimits).where(eq(schema.planLimits.plan, plan));
    const { limits } = catalog[plan];
    for (const [key, value] of Object.entries(limits)) {
      expect({ key, value: (row as Record<string, unknown>)[key] }).toEqual({ key, value });
    }
  });

  it("overage rates", async () => {
    const [row] = await database.select().from(schema.overagePricing).where(eq(schema.overagePricing.plan, plan));
    const { overageCents } = catalog[plan];
    expect(row.playwrightMinutePriceCents).toBe(overageCents.playwrightMinutes);
    expect(row.k6VuMinutePriceCentsOverride ?? row.k6VuMinutePriceCents).toBe(overageCents.k6VuMinutes);
    expect(row.sreInvestigationUnitPriceCents).toBe(overageCents.sreInvestigationUnits);
  });
});

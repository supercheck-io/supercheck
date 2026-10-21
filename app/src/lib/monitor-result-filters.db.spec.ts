/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, count, eq, sql } from "drizzle-orm";
import { monitorResults } from "@/db/schema";
import {
  excludeSupersededSyntheticResults,
  excludeSyntheticResults,
} from "./monitor-result-filters";

/**
 * The filters rely on SQL three-valued logic (NULL details, NULL group ids), which a mocked
 * client cannot prove. A minimal table with the columns they read stands in for the full schema.
 */
const name = `result_filters_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
const monitorId = randomUUID();

const row = (
  id: string,
  location: string,
  group: string | null,
  details: object | null,
) =>
  client`INSERT INTO monitor_results (id, monitor_id, execution_group_id, location, details)
         VALUES (${id}, ${monitorId}, ${group}, ${location}, ${details === null ? null : JSON.stringify(details)}::jsonb)`;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  client = postgres(target.toString(), { max: 2, onnotice: () => {} });
  db = drizzle(client);
  await client.unsafe(`CREATE TABLE monitor_results (
    id text PRIMARY KEY, monitor_id text NOT NULL, execution_group_id text,
    location text, details jsonb)`);
});

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  await client`TRUNCATE monitor_results`;
});

const counted = async (filter: ReturnType<typeof sql>) =>
  Number(
    (
      await db
        .select({ n: count() })
        .from(monitorResults)
        .where(and(eq(monitorResults.monitorId, monitorId), filter))
    )[0].n,
  );

describe("excludeSupersededSyntheticResults", () => {
  it("keeps legacy rows with no details and rows with no execution group", async () => {
    await row("a", "us", null, null);
    await row("b", "eu", "g1", {});

    expect(await counted(excludeSupersededSyntheticResults)).toBe(2);
  });

  it("keeps a synthetic row when no real result arrived for that region", async () => {
    await row("s", "eu", "g1", { synthetic: true });
    await row("r", "us", "g1", {});

    expect(await counted(excludeSupersededSyntheticResults)).toBe(2);
  });

  it("counts a late real result once instead of alongside its synthetic row", async () => {
    await row("s", "eu", "g1", { synthetic: true });
    await row("late", "eu", "g1", { statusCode: 200 });

    expect(await counted(excludeSupersededSyntheticResults)).toBe(1);
    const kept = await db
      .select({ id: monitorResults.id })
      .from(monitorResults)
      .where(excludeSupersededSyntheticResults);
    expect(kept.map((r) => r.id)).toEqual(["late"]);
  });

  it("does not let a real result in another cycle or region supersede the synthetic row", async () => {
    await row("s", "eu", "g1", { synthetic: true });
    await row("other-cycle", "eu", "g2", {});
    await row("other-region", "us", "g1", {});

    expect(await counted(excludeSupersededSyntheticResults)).toBe(3);
  });
});

describe("excludeSyntheticResults", () => {
  it("drops synthetic rows and keeps everything else", async () => {
    await row("s", "eu", "g1", { synthetic: true });
    await row("legacy", "us", null, null);
    await row("real", "us", "g1", {});

    expect(await counted(excludeSyntheticResults)).toBe(2);
  });
});

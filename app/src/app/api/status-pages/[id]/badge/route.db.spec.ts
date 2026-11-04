/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
import { GET } from "./route";

const execFileAsync = promisify(execFile);
const name = `badge_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let orgId: string;

const badge = async (id: string) =>
  (await GET(new NextRequest(`http://x/api/status-pages/${id}/badge`), { params: Promise.resolve({ id }) })).text();

async function page(label: string) {
  const [row] = await mockDatabase
    .insert(schema.statusPages)
    .values({ organizationId: orgId, name: label, subdomain: randomUUID(), status: "published" })
    .returning();
  await mockDatabase.insert(schema.statusPageComponents).values({ statusPageId: row.id, name: "web", status: "operational" });
  return row.id;
}
const incident = (statusPageId: string, v: Partial<typeof schema.incidents.$inferInsert>) =>
  mockDatabase.insert(schema.incidents).values({ statusPageId, name: "i", ...v });

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../../../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  [{ id: orgId }] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
});

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

describe("status badge incident predicate (real database)", () => {
  it("ignores other pages' incidents, resolved incidents and scheduled maintenance", async () => {
    const mine = await page("mine");
    const other = await page("other");
    const now = new Date();
    await incident(other, { status: "investigating", impact: "critical" });
    await incident(mine, { status: "resolved", impact: "critical" });
    await incident(mine, {
      status: "scheduled", impact: "critical", scheduledFor: now, scheduledUntil: new Date(now.getTime() + 3600_000),
    });
    await incident(mine, {
      status: "monitoring", impact: "critical", scheduledFor: now, scheduledUntil: new Date(now.getTime() + 3600_000),
    });
    expect(await badge(mine)).toContain("operational");
  });

  it("shows the worst open incident impact", async () => {
    const id = await page("open");
    await incident(id, { status: "investigating", impact: "minor" });
    await incident(id, { status: "identified", impact: "major" });
    await incident(id, { status: "monitoring", impact: "none" });
    expect(await badge(id)).toContain("partial outage");
  });
});

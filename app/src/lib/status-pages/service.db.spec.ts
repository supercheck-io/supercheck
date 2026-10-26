/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { updateComponent } from "./service";

const execFileAsync = promisify(execFile);
const name = `status_svc_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("keeps a surviving monitor's weight when monitorIds change without new weights", async () => {
  const [organization] = await mockDatabase
    .insert(schema.organization)
    .values({ name: "Test", createdAt: new Date() })
    .returning();
  const [project] = await mockDatabase
    .insert(schema.projects)
    .values({ organizationId: organization.id, name: "Project" })
    .returning();
  const [user] = await mockDatabase
    .insert(schema.user)
    .values({ name: "Test User", email: `${randomUUID()}@example.com` })
    .returning();
  const [page] = await mockDatabase
    .insert(schema.statusPages)
    .values({
      organizationId: organization.id,
      projectId: project.id,
      name: "Status",
      subdomain: randomUUID().replaceAll("-", ""),
      status: "published",
    })
    .returning();
  const [a, b] = await mockDatabase
    .insert(schema.monitors)
    .values(
      ["A", "B"].map((n) => ({
        organizationId: organization.id,
        projectId: project.id,
        name: n,
        type: "http_request" as const,
        target: "https://example.com",
        status: "up" as const,
      })),
    )
    .returning();
  const [component] = await mockDatabase
    .insert(schema.statusPageComponents)
    .values({ statusPageId: page.id, name: "API" })
    .returning();
  const ctx = { userId: user.id, organizationId: organization.id, projectId: project.id };

  const first = await updateComponent(ctx, page.id, component.id, {
    monitorIds: [a.id, b.id],
    monitorWeights: { [a.id]: 3, [b.id]: 5 },
  });
  expect(first.ok).toBe(true);

  const second = await updateComponent(ctx, page.id, component.id, { monitorIds: [b.id] });
  expect(second.ok).toBe(true);

  const links = await mockDatabase
    .select()
    .from(schema.statusPageComponentMonitors)
    .where(eq(schema.statusPageComponentMonitors.componentId, component.id));
  expect(links.map((l) => [l.monitorId, l.weight])).toEqual([[b.id, 5]]);
});

/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
let mockContext: { userId: string; organizationId: string; project: { id: string } };
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => mockContext),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn(async () => undefined) }));

import { PATCH } from "./route";

const execFileAsync = promisify(execFile);
const dbName = `monitors_tags_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let entityId: string;
let tagIds: string[];

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${dbName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${dbName}`;
  const appRoot = path.resolve(__dirname, "../../../../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
  });
  client = postgres(target.toString(), { max: 10, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "Project" }).returning();
  const [entity] = await mockDatabase
    .insert(schema.monitors)
    .values({ organizationId: org.id, projectId: project.id, name: "M", type: "http_request", target: "https://example.com" })
    .returning();
  entityId = entity.id;
  const created = await mockDatabase
    .insert(schema.tags)
    .values(Array.from({ length: 12 }, (_, i) => ({ organizationId: org.id, projectId: project.id, name: `tag-${i}` })))
    .returning();
  tagIds = created.map((t) => t.id);
  mockContext = { userId: randomUUID(), organizationId: org.id, project: { id: project.id } };
});

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("concurrent PATCH requests cannot push a monitor past the 10-tag cap", async () => {
  const patch = (add: string[]) =>
    PATCH(
      new NextRequest(`http://localhost/api/monitors/${entityId}/tags`, { method: "PATCH", body: JSON.stringify({ add }) }),
      { params: Promise.resolve({ id: entityId }) },
    );
  // Four requests of three distinct tags each would total 12 without the row lock.
  const responses = await Promise.all([0, 3, 6, 9].map((i) => patch(tagIds.slice(i, i + 3))));
  const statuses = responses.map((r) => r.status).sort();

  const rows = await mockDatabase.select().from(schema.monitorTags).where(eq(schema.monitorTags.monitorId, entityId));
  expect(rows.length).toBeLessThanOrEqual(10);
  expect(statuses.filter((s) => s === 400)).toHaveLength(1);
  expect(statuses.filter((s) => s === 200)).toHaveLength(3);
});

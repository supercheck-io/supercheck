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

import { collectPrivateAgentEvidence } from "./connector-tools";

const execFileAsync = promisify(execFile);
const name = `evidence_dedupe_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let scope: { organizationId: string; projectId: string; incidentId: string };
let connector: typeof schema.externalConnectors.$inferSelect;

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
  client = postgres(target.toString(), { max: 20, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

beforeEach(async () => {
  await client`TRUNCATE organization, "user" CASCADE`;
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [incident] = await mockDatabase
    .insert(schema.sreIncidents)
    .values({ organizationId: org.id, projectId: project.id, incidentNumber: 1, title: "Down", severity: "sev2" })
    .returning();
  [connector] = await mockDatabase
    .insert(schema.externalConnectors)
    .values({ organizationId: org.id, projectId: project.id, name: "Prom", type: "prometheus" })
    .returning();
  scope = { organizationId: org.id, projectId: project.id, incidentId: incident.id };
});

const collect = (jobId: string) =>
  collectPrivateAgentEvidence({
    scope,
    connector,
    jobId,
    query: "up",
    maxItems: 5,
    resultSummary: {
      evidence: [
        {
          id: "provider-evidence",
          sourceUri: "https://prometheus.internal/graph",
          title: "Health",
          summary: "up=0",
          evidenceType: "metric",
          observedAt: "2026-11-20T10:00:00.000Z",
          resultHash: "a".repeat(64),
        },
      ],
    },
  });

it("stores one evidence row when several runs persist the same result at once", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => collect(`job-${i}`)));

  const rows = await mockDatabase
    .select()
    .from(schema.sreEvidenceItems)
    .where(eq(schema.sreEvidenceItems.incidentId, scope.incidentId));
  expect(rows).toHaveLength(1);
  // Every caller gets the same stored row back.
  expect(new Set(results.map(([row]) => row.id))).toEqual(new Set([rows[0].id]));
});

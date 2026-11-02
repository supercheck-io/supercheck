/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). The service-resource and trial-suspension links
// carry a polymorphic resource_id, so no foreign key cascades them; the delete paths must remove them.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
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
import {
  deleteStatusPageWithLinks,
  removeK6RunLinks,
  removeServiceResourceLinks,
  removeTrialSuspensions,
} from "./linked-records";

const name = `linked_records_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

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
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
}, 100000);

afterAll(async () => {
  await client?.end({ timeout: 5 });
  await maintenance?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await maintenance?.end({ timeout: 5 });
});

async function seed() {
  const [organization] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: organization.id, name: "P" }).returning();
  const [service] = await mockDatabase
    .insert(schema.sreServices)
    .values({ organizationId: organization.id, projectId: project.id, name: `svc-${randomUUID()}` })
    .returning();
  return { organization, project, service };
}
const linksOf = (serviceId: string) =>
  mockDatabase.select().from(schema.sreServiceResources).where(eq(schema.sreServiceResources.serviceId, serviceId));

it("removes only the links of the deleted resource", async () => {
  const { service } = await seed();
  const gone = randomUUID();
  const kept = randomUUID();
  await mockDatabase.insert(schema.sreServiceResources).values([
    { serviceId: service.id, resourceType: "monitor", resourceId: gone },
    { serviceId: service.id, resourceType: "monitor", resourceId: kept },
    // Same id under another type is a different resource.
    { serviceId: service.id, resourceType: "job", resourceId: gone },
  ]);
  await removeServiceResourceLinks(mockDatabase, "monitor", [gone]);
  expect((await linksOf(service.id)).map((l) => [l.resourceType, l.resourceId]).sort()).toEqual(
    [["job", gone], ["monitor", kept]].sort(),
  );
  await removeServiceResourceLinks(mockDatabase, "monitor", []);
});

it("removes the k6 run links of the deleted runs only", async () => {
  const { organization, project, service } = await seed();
  const [runA] = await mockDatabase.insert(schema.runs).values({ projectId: project.id }).returning();
  const [runB] = await mockDatabase.insert(schema.runs).values({ projectId: project.id }).returning();
  const perf = (runId: string) => ({ runId, organizationId: organization.id, projectId: project.id, status: "passed" as const });
  const [k6A] = await mockDatabase.insert(schema.k6PerformanceRuns).values(perf(runA.id)).returning();
  const [k6B] = await mockDatabase.insert(schema.k6PerformanceRuns).values(perf(runB.id)).returning();
  await mockDatabase.insert(schema.sreServiceResources).values([
    { serviceId: service.id, resourceType: "k6_run", resourceId: k6A.id },
    { serviceId: service.id, resourceType: "k6_run", resourceId: k6B.id },
  ]);
  await removeK6RunLinks(mockDatabase, [runA.id]);
  expect((await linksOf(service.id)).map((l) => l.resourceId)).toEqual([k6B.id]);
});

it("removes the trial suspension of the deleted resource", async () => {
  const { organization } = await seed();
  const gone = randomUUID();
  const kept = randomUUID();
  await mockDatabase.insert(schema.trialSuspensions).values([
    { organizationId: organization.id, resourceType: "monitor", resourceId: gone, previousStatus: "active" },
    { organizationId: organization.id, resourceType: "monitor", resourceId: kept, previousStatus: "active" },
  ]);
  await removeTrialSuspensions(mockDatabase, "monitor", [gone]);
  const rows = await mockDatabase.select().from(schema.trialSuspensions).where(eq(schema.trialSuspensions.organizationId, organization.id));
  expect(rows.map((r) => r.resourceId)).toEqual([kept]);
});

it("deleting a status page removes its component links and trial suspension, and respects the project scope", async () => {
  const { organization, project, service } = await seed();
  const [page] = await mockDatabase
    .insert(schema.statusPages)
    .values({ organizationId: organization.id, projectId: project.id, name: "S", subdomain: randomUUID().replaceAll("-", "") })
    .returning();
  const [component] = await mockDatabase.insert(schema.statusPageComponents).values({ statusPageId: page.id, name: "C" }).returning();
  await mockDatabase.insert(schema.sreServiceResources).values({ serviceId: service.id, resourceType: "status_page_component", resourceId: component.id });
  await mockDatabase.insert(schema.trialSuspensions).values({ organizationId: organization.id, resourceType: "status_page", resourceId: page.id, previousStatus: "published" });

  // Another project's id must not delete it or its links.
  expect(await deleteStatusPageWithLinks(page.id, organization.id, randomUUID())).toEqual([]);
  expect(await linksOf(service.id)).toHaveLength(1);

  expect(await deleteStatusPageWithLinks(page.id, organization.id, project.id)).toEqual([{ id: page.id }]);
  expect(await linksOf(service.id)).toEqual([]);
  expect(await mockDatabase.select().from(schema.trialSuspensions).where(eq(schema.trialSuspensions.resourceId, page.id))).toEqual([]);
  expect(await mockDatabase.select().from(schema.statusPages).where(eq(schema.statusPages.id, page.id))).toEqual([]);
});

/** @jest-environment node */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
let mockDatabase: ReturnType<typeof drizzle>;
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));
const mockContext = {
  userId: "user-1",
  organizationId: "org-1",
  project: { id: "project-1" },
};
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => mockContext),
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => mockContext),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(() => true),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
import { NextRequest } from "next/server";
import { getRequirement, getRequirements } from "@/actions/requirements";
import { GET } from "@/app/api/requirements/route";

const databaseName = `requirements_pagination_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${databaseName}`;
  client = postgres(target.toString(), { max: 1 });
  mockDatabase = drizzle(client);
  // Only the listing projection is needed; no application data or migrations are changed.
  await client.unsafe(`
    CREATE TABLE requirements (id text PRIMARY KEY, project_id text, organization_id text, title text,
      description text, priority text, source_document_id text, source_section text,
      external_id text, external_url text, external_provider text, created_by text,
      created_at timestamptz, updated_at timestamptz);
    CREATE TABLE requirement_coverage_snapshots (requirement_id text PRIMARY KEY,
      status text, linked_test_count integer, passed_test_count integer, failed_test_count integer);
    CREATE TABLE requirement_documents (id text PRIMARY KEY, name text, project_id text, organization_id text);
    CREATE TABLE tags (id text PRIMARY KEY, project_id text, name text, color text);
    CREATE TABLE requirement_tags (requirement_id text, tag_id text);
    INSERT INTO requirements (id, project_id, title, created_at) VALUES
      ('covered', 'project-1', 'Covered', '2026-01-05'),
      ('no-snapshot', 'project-1', 'No snapshot', '2026-01-04'),
      ('failing', 'project-1', 'Failing', '2026-01-03'),
      ('missing', 'project-1', 'Missing', '2026-01-02'),
      ('foreign', 'project-2', 'Other project', '2026-01-06');
    INSERT INTO requirement_coverage_snapshots (requirement_id, status) VALUES
      ('covered', 'covered'), ('failing', 'failing'), ('missing', 'missing');
  `);
});
afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
    await maintenance.end({ timeout: 5 });
  }
});

describe.each(["action", "API"])(
  "requirement pagination database behavior via %s",
  (entry) => {
    async function list(
      page: number,
      status?: "missing" | "covered" | "failing",
    ) {
      if (entry === "action")
        return getRequirements({ page, pageSize: 1, status });
      const response = await GET(
        new NextRequest(
          `http://localhost/api/requirements?page=${page}&pageSize=1${status ? `&status=${status}` : ""}`,
        ),
      );
      expect(response.status).toBe(200);
      return response.json();
    }
    it("paginates matching coverage including absent snapshots and counts only this project", async () => {
      const first = await list(1, "missing");
      const second = await list(2, "missing");
      expect(first.total).toBe(2);
      expect(second.total).toBe(2);
      expect(first.requirements.map((row: { id: string }) => row.id)).toEqual([
        "no-snapshot",
      ]);
      expect(second.requirements.map((row: { id: string }) => row.id)).toEqual([
        "missing",
      ]);
      expect(first.requirements[0].coverageStatus).toBe("missing");
    });
    it.each(["covered", "failing"] as const)(
      "returns the exact %s total and first page",
      async (status) => {
        const result = await list(1, status);
        expect(result.total).toBe(1);
        expect(
          result.requirements.map((row: { id: string }) => row.id),
        ).toEqual([status]);
      },
    );
    it.each([
      ["local", "Local source"],
      ["other-project", null],
      ["other-org", null],
    ])("scopes source document metadata for %s", async (documentId, expectedName) => {
      await client.unsafe(`
        INSERT INTO requirement_documents (id, name, project_id, organization_id) VALUES
          ('local', 'Local source', 'project-1', 'org-1'),
          ('other-project', 'Other project source', 'project-2', 'org-1'),
          ('other-org', 'Other organization source', 'project-1', 'org-2')
        ON CONFLICT (id) DO NOTHING;
      `);
      await client`UPDATE requirements SET organization_id = 'org-1', source_document_id = ${documentId} WHERE id = 'covered'`;
      const result = await list(1, "covered");
      expect(result.requirements[0].sourceDocumentName).toBe(expectedName);
      if (entry === "action") {
        expect((await getRequirement("covered"))?.sourceDocumentName).toBe(expectedName);
      }
    });

    it("preserves unfiltered pagination", async () => {
      const result = await list(1);
      expect(result.total).toBe(4);
      expect(result.requirements.map((row: { id: string }) => row.id)).toEqual([
        "covered",
      ]);
    });
  },
);

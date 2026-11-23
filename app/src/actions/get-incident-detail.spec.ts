import { PgDialect } from "drizzle-orm/pg-core";

jest.mock("@/utils/db", () => ({
  db: {
    query: { incidents: { findFirst: jest.fn() } },
    select: jest.fn(() => ({ from: () => ({ where: () => "scoped-status-pages" }) })),
  },
}));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResult: jest.fn(async (_org: string, message: string) => ({ success: false, error: message, message })),
}));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { getIncidentDetail } from "./get-incident-detail";

const id = "550e8400-e29b-41d4-a716-446655440000";
const findFirst = db.query.incidents.findFirst as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (requireProjectContext as jest.Mock).mockResolvedValue({ organizationId: "org-1", project: { id: "project-1" } });
});

it("scopes the read to the caller's status pages in the WHERE clause", async () => {
  findFirst.mockResolvedValue(null);
  expect(await getIncidentDetail(id)).toMatchObject({ success: false, message: "Incident not found" });
  const where = findFirst.mock.calls[0][0].where;
  expect(new PgDialect().sqlToQuery(where).sql).toContain('"status_page_id" in');
});

it("returns the incident with only public status page fields", async () => {
  findFirst.mockResolvedValue({ id, updates: [], statusPage: { id: "sp", name: "n", headline: "h", subdomain: "s" } });
  const result = await getIncidentDetail(id);
  expect(result).toMatchObject({ success: true, incident: { statusPage: { id: "sp", name: "n", headline: "h", subdomain: "s" } } });
});

it("reports a permission failure distinctly, without reading the incident", async () => {
  (requirePermissions as jest.Mock).mockRejectedValue(new Error("Access denied: Missing status_page:view permission"));
  expect(await getIncidentDetail(id)).toMatchObject({
    success: false,
    incident: null,
    message: "Insufficient permissions to view incidents",
  });
  expect(findFirst).not.toHaveBeenCalled();
});

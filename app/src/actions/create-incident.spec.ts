jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: jest.fn() } }, transaction: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p", name: "P" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { db } from "@/utils/db";
import { createIncident } from "./create-incident";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("rejects an unbounded affectedComponentIds list before touching the database", async () => {
  const result = await createIncident({
    statusPageId: uuid(1),
    name: "Outage",
    status: "investigating",
    impact: "minor",
    affectedComponentIds: Array.from({ length: 101 }, (_, i) => uuid(i + 10)),
  } as never);
  expect(result.success).toBe(false);
  expect(db.query.statusPages.findFirst).not.toHaveBeenCalled();
});

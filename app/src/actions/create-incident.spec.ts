jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: jest.fn() }, sreIncidents: { findFirst: jest.fn() } }, transaction: jest.fn() } }));
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

it("scopes the for-update locks on the status page and SRE incident to the org and project", async () => {
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id: uuid(1), language: "en" });
  (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: uuid(2) });
  (db as unknown as { select: jest.Mock }).select = jest.fn(() => ({ from: () => ({ where: async () => [{ id: uuid(3) }] }) }));
  const wheres: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          wheres.push(condition);
          return { for: async () => [{ statusPageIncidentId: "already-linked" }] };
        },
      }),
    }),
    query: { incidents: { findFirst: jest.fn().mockResolvedValue(undefined) } },
  };
  (db.transaction as jest.Mock).mockImplementation((callback: (t: typeof tx) => unknown) => callback(tx));
  const result = await createIncident({
    statusPageId: uuid(1),
    sreIncidentId: uuid(2),
    name: "Outage",
    status: "investigating",
    impact: "minor",
    affectedComponentIds: [uuid(3)],
  } as never);
  expect(result.success).toBe(false);
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
  expect(wheres).toHaveLength(2);
  for (const where of wheres) {
    expect(new PgDialect().sqlToQuery(where as never).params).toEqual(expect.arrayContaining(["o", "p"]));
  }
});

it("tells the user when the SRE incident already has a public incident on the page", async () => {
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id: uuid(1), language: "en" });
  (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: uuid(2) });
  (db as unknown as { select: jest.Mock }).select = jest.fn(() => ({ from: () => ({ where: async () => [{ id: uuid(3) }] }) }));
  (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
    query: { incidents: { findFirst: async () => ({ id: uuid(9) }) } },
  }));
  const result = await createIncident({
    statusPageId: uuid(1), sreIncidentId: uuid(2), name: "Outage", status: "investigating", impact: "minor",
    affectedComponentIds: [uuid(3)], componentStatus: "partial_outage", deliverNotifications: false,
  } as never);
  expect(result).toEqual({ success: false, message: "This incident already has a public incident on this status page." });
});

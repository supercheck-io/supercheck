import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { sreIncidents, sreServices } from "@/db/schema";
import { db } from "@/utils/db";
import { getSreEvidenceGraph } from "./evidence-graph-queries";

jest.mock("@/utils/db", () => ({ db: {
  query: { sreIncidents: { findFirst: jest.fn() } }, select: jest.fn(),
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn().mockResolvedValue({
  userId: "user-1", organizationId: "org-1", project: { id: "project-1" },
}) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn().mockReturnValue(true) }));

const incidentId = "018f0000-0000-7000-8000-000000000001";
const serviceId = "018f0000-0000-7000-8000-000000000002";
const dialect = new PgDialect();

describe("incident-focused evidence graph", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("prioritizes an older incident and its service before the recent-row limits", async () => {
    jest.mocked(db.query.sreIncidents.findFirst).mockResolvedValue({ id: incidentId, primaryServiceId: serviceId } as never);
    const ordering = new Map<unknown, SQL[]>();
    const limits = new Map<unknown, number>();
    jest.mocked(db.select).mockImplementation(() => {
      let table: unknown;
      const chain = {
        from: jest.fn(),
        where: jest.fn(),
        innerJoin: jest.fn(),
        orderBy: jest.fn(),
        getSQL: () => sql`select 'alert-1'`,
        limit: jest.fn(async (value: number) => {
          limits.set(table, value);
          return table === sreIncidents ? [{ id: incidentId, incidentNumber: 7, title: "Older incident",
            severity: "sev2", status: "investigating", primaryServiceId: serviceId, createdAt: new Date(0) }]
            : table === sreServices ? [{ id: serviceId, name: "Older service", status: "active", tier: 1, createdAt: new Date(0) }] : [];
        }),
      };
      chain.from.mockImplementation((value: unknown) => { table = value; return chain; });
      chain.where.mockReturnValue(chain);
      chain.innerJoin.mockReturnValue(chain);
      chain.orderBy.mockImplementation((...values: SQL[]) => { ordering.set(table, values); return chain; });
      return chain as never;
    });
    const result = await getSreEvidenceGraph(incidentId);
    expect(result.success).toBe(true);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: `incident:${incidentId}` })]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({
      source: `service:${serviceId}`, target: `incident:${incidentId}`,
    })]));
    expect(dialect.sqlToQuery(ordering.get(sreIncidents)![0])).toMatchObject({ params: [incidentId], sql: expect.stringContaining("desc") });
    expect(dialect.sqlToQuery(ordering.get(sreServices)![0])).toMatchObject({ params: [serviceId] });
    expect(limits.get(sreIncidents)).toBe(60);
    const lookup = jest.mocked(db.query.sreIncidents.findFirst).mock.calls[0][0]!;
    expect(dialect.sqlToQuery(lookup.where as SQL).params).toEqual([incidentId, "org-1", "project-1"]);
  });

  it("rejects a missing or inaccessible incident instead of silently opening all incidents", async () => {
    jest.mocked(db.query.sreIncidents.findFirst).mockResolvedValue(undefined);
    expect(await getSreEvidenceGraph(incidentId)).toMatchObject({ success: false, error: "Incident not found or access denied" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects invalid deep links before querying the database", async () => {
    expect(await getSreEvidenceGraph("invalid")).toMatchObject({ success: false, error: "Invalid incident ID" });
    expect(db.query.sreIncidents.findFirst).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});

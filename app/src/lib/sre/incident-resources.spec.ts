jest.mock("@/utils/db", () => ({ db: {} }));
import { PgDialect } from "drizzle-orm/pg-core";
import { addIncidentResources, findOpenIncidentListingMonitor, resolveIncidentResources } from "./incident-resources";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { organizationId: "org-1", projectId: "project-1" };

function executor(results: unknown[][]) {
  const wheres: unknown[] = [];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "orderBy"]) c[m] = () => c;
    c.where = (w: unknown) => { wheres.push(w); return Object.assign(Promise.resolve(rows), c); };
    c.limit = () => Promise.resolve(rows);
    return c;
  };
  return { select: jest.fn(() => chain(results.shift() ?? [])), wheres };
}

describe("resolveIncidentResources", () => {
  it("returns named refs when every id is in the project", async () => {
    const ex = executor([[{ id: uuid(1), name: "Checkout API" }], [{ id: uuid(2), name: "Checkout" }]]);
    expect(await resolveIncidentResources(ex as never, scope, { serviceIds: [uuid(1), uuid(1)], monitorIds: [uuid(2)] })).toEqual([
      { type: "service", id: uuid(1), name: "Checkout API" },
      { type: "monitor", id: uuid(2), name: "Checkout" },
    ]);
    for (const where of ex.wheres) expect(new PgDialect().sqlToQuery(where as never).params).toEqual(expect.arrayContaining(["org-1", "project-1"]));
  });

  it("treats upper- and lower-case forms of one UUID as the same id", async () => {
    const ex = executor([[{ id: uuid(1), name: "Checkout API" }]]);
    expect(await resolveIncidentResources(ex as never, scope, { serviceIds: [uuid(1), uuid(1).toUpperCase()], monitorIds: [] })).toHaveLength(1);
  });

  it("returns null when any id is unknown or elsewhere, and skips empty lookups", async () => {
    const ex = executor([[]]);
    expect(await resolveIncidentResources(ex as never, scope, { serviceIds: [], monitorIds: [uuid(2)] })).toBeNull();
    expect(ex.select).toHaveBeenCalledTimes(1);
    const none = executor([]);
    expect(await resolveIncidentResources(none as never, scope, { serviceIds: [], monitorIds: [] })).toEqual([]);
    expect(none.select).not.toHaveBeenCalled();
  });
});

describe("addIncidentResources", () => {
  it("returns only the rows actually inserted", async () => {
    const values = jest.fn(() => ({ onConflictDoNothing: () => ({ returning: async () => [{ type: "monitor", id: uuid(2) }] }) }));
    const ex = { insert: jest.fn(() => ({ values })) };
    const refs = [{ type: "monitor" as const, id: uuid(2), name: "a" }, { type: "service" as const, id: uuid(1), name: "b" }];
    expect(await addIncidentResources(ex as never, "inc-1", refs)).toEqual([refs[0]]);
    expect(await addIncidentResources(ex as never, "inc-1", [])).toEqual([]);
    expect(ex.insert).toHaveBeenCalledTimes(1);
  });
});

describe("findOpenIncidentListingMonitor", () => {
  it("filters on the incident's org and project and answers null when none", async () => {
    const ex = executor([[]]);
    expect(await findOpenIncidentListingMonitor(ex as never, { ...scope, monitorId: uuid(2) })).toBeNull();
    // The subquery builds first; the outer filter is the last where.
    const params = new PgDialect().sqlToQuery(ex.wheres.at(-1) as never).params;
    expect(params).toEqual(expect.arrayContaining(["org-1", "project-1", "resolved", uuid(2)]));
  });
});

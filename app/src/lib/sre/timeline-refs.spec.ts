jest.mock("@/utils/db", () => ({ db: {} }));
import { PgDialect } from "drizzle-orm/pg-core";
import { loadTimelineRefs } from "./timeline-refs";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function executor(results: unknown[][]) {
  const wheres: unknown[] = [];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.innerJoin = () => c;
    c.where = (w: unknown) => { wheres.push(w); return Promise.resolve(rows); };
    return c;
  };
  return { select: jest.fn(() => chain(results.shift() ?? [])), wheres };
}

describe("loadTimelineRefs", () => {
  it("skips both lookups when no row carries an id", async () => {
    const ex = executor([]);
    expect(await loadTimelineRefs(ex as never, { organizationId: "o", projectId: "p", rows: [{ eventData: { alertEventId: "not-a-uuid", channels: [{ providerId: "not-a-uuid" }, null] } }, { eventData: null }] })).toEqual({ users: {}, alerts: {}, providers: {} });
    expect(ex.select).not.toHaveBeenCalled();
  });

  it("names members and alerts, scoping alert titles to the org and project", async () => {
    const ex = executor([[{ id: uuid(1), name: "Priya" }], [{ id: uuid(2), title: "Checkout 5xx" }]]);
    const refs = await loadTimelineRefs(ex as never, {
      organizationId: "org-1",
      projectId: "project-1",
      rows: [{ eventData: { createdByUserId: uuid(1), alertEventId: uuid(2) } }, { eventData: { assigneeUserId: uuid(1) } }],
    });
    expect(refs).toEqual({ users: { [uuid(1)]: "Priya" }, alerts: { [uuid(2)]: "Checkout 5xx" }, providers: {} });
    expect(new PgDialect().sqlToQuery(ex.wheres[1] as never).params).toEqual(expect.arrayContaining(["org-1", "project-1"]));
  });

  it("names channels only through an org- and project-scoped lookup, so another org's provider id never resolves", async () => {
    const ours = uuid(3);
    const theirs = uuid(4);
    // The database returns only rows that pass the where clause: here, our provider.
    const ex = executor([[{ id: ours, name: "#ops-alerts" }]]);
    const refs = await loadTimelineRefs(ex as never, {
      organizationId: "org-1",
      projectId: "project-1",
      rows: [{ eventData: { kind: "escalation", channels: [{ providerId: ours, ok: true }, { providerId: theirs, ok: true }] } }],
    });
    expect(refs.providers).toEqual({ [ours]: "#ops-alerts" });
    expect(refs.providers[theirs]).toBeUndefined();
    const { sql, params } = new PgDialect().sqlToQuery(ex.wheres[0] as never);
    expect(sql).toMatch(/"notification_providers"\."organization_id" = \$\d+/);
    expect(sql).toMatch(/"notification_providers"\."project_id" = \$\d+/);
    expect(params).toEqual(expect.arrayContaining([ours, theirs, "org-1", "project-1"]));
  });
});

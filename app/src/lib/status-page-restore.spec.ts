/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { restoreResolvedIncidentComponents } from "./status-page-reconciliation";

type Link = { componentId: string; oldStatus: string | null; newStatus: string | null; status: string };

/** A tx whose selects return the queued rows in order (links, other open incidents, monitored components). */
function makeTx(links: Link[], busy: string[] = [], monitored: string[] = []) {
  const queue = [links, busy.map((componentId) => ({ componentId })), monitored.map((componentId) => ({ componentId }))];
  const sets: Array<Record<string, unknown>> = [];
  const select = jest.fn(() => {
    const rows = queue.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  });
  const update = jest.fn(() => ({ set: (v: Record<string, unknown>) => (sets.push(v), { where: jest.fn(async () => undefined) }) }));
  return { tx: { select, update } as never, select, update, sets };
}
const link = (over: Partial<Link> = {}): Link => ({ componentId: "c1", oldStatus: "operational", newStatus: "degraded_performance", status: "degraded_performance", ...over });
const run = (tx: never) => restoreResolvedIncidentComponents(tx, "i1", "p1");

describe("restoreResolvedIncidentComponents", () => {
  it("restores a component the incident degraded to operational", async () => {
    const { tx, sets } = makeTx([link()]);
    await run(tx);
    expect(sets).toEqual([expect.objectContaining({ status: "operational" })]);
  });

  it("leaves a component that was changed by hand since the incident set it", async () => {
    const { tx, update, select } = makeTx([link({ status: "major_outage" })]);
    await run(tx);
    expect(update).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("leaves a component another open incident still affects", async () => {
    const { tx, update } = makeTx([link()], ["c1"]);
    await run(tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a component with linked monitors to reconciliation, which reads their current health", async () => {
    const { tx, update } = makeTx([link()], [], ["c1"]);
    await run(tx);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns a maintenance component to the status saved when it began, and falls back to operational", async () => {
    const maintenance = { newStatus: "under_maintenance", status: "under_maintenance" };
    const { tx, sets, update } = makeTx([
      link({ componentId: "a", oldStatus: "degraded_performance", ...maintenance }),
      link({ componentId: "b", oldStatus: "under_maintenance", ...maintenance }),
      link({ componentId: "c", oldStatus: null, ...maintenance }),
    ]);
    await run(tx);
    expect(sets.map((s) => s.status).sort()).toEqual(["degraded_performance", "operational"]);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("writes one update for many components moving to the same status", async () => {
    const { tx, update } = makeTx([link({ componentId: "a" }), link({ componentId: "b" }), link({ componentId: "c" })]);
    await run(tx);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

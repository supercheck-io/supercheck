/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { linkOpenSreIncident, repointSreStatusPageSlot } from "./status-page-reconciliation";

function makeTx(match: { id: string } | undefined) {
  const set = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
  const update = jest.fn(() => ({ set }));
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = async () => (match ? [match] : []);
  const tx = { select: () => chain, update };
  return { tx: tx as never, update, set };
}

const args = {
  statusPageIncidentId: "sp-1",
  organizationId: "org",
  projectId: "proj",
  monitorIds: ["m1"],
};

describe("linkOpenSreIncident", () => {
  it("does nothing without monitors", async () => {
    const { tx, update } = makeTx({ id: "sre-1" });
    expect(await linkOpenSreIncident(tx, { ...args, monitorIds: [] })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without a project scope", async () => {
    const { tx, update } = makeTx({ id: "sre-1" });
    expect(await linkOpenSreIncident(tx, { ...args, projectId: null })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing when no open SRE incident matches", async () => {
    const { tx, update } = makeTx(undefined);
    expect(await linkOpenSreIncident(tx, args)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("links both sides when an open SRE incident matches", async () => {
    const { tx, update, set } = makeTx({ id: "sre-1" });
    expect(await linkOpenSreIncident(tx, args)).toBe("sre-1");
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(1, { sreIncidentId: "sre-1" });
    expect(set).toHaveBeenNthCalledWith(2, { statusPageIncidentId: "sp-1" });
  });
});

describe("repointSreStatusPageSlot", () => {
  function makeRepointTx(results: unknown[][]) {
    const set = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
    const queue = [...results];
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.limit = async () => queue.shift() ?? [];
    return { tx: { select: () => chain, update: () => ({ set }) } as never, set };
  }

  it("moves the slot to another open public incident of the same SRE incident", async () => {
    const { tx, set } = makeRepointTx([[{ id: "sre-1" }], [{ id: "sp-2" }]]);
    await repointSreStatusPageSlot(tx, "sp-1");
    expect(set).toHaveBeenCalledWith({ statusPageIncidentId: "sp-2" });
  });

  it("clears the slot when no other public incident is open, and does nothing when the incident owns no slot", async () => {
    const none = makeRepointTx([[{ id: "sre-1" }], []]);
    await repointSreStatusPageSlot(none.tx, "sp-1");
    expect(none.set).toHaveBeenCalledWith({ statusPageIncidentId: null });
    const unowned = makeRepointTx([[]]);
    await repointSreStatusPageSlot(unowned.tx, "sp-1");
    expect(unowned.set).not.toHaveBeenCalled();
  });
});

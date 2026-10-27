/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));

import { linkOpenSreIncident } from "./status-page-reconciliation";

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

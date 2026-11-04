/** @jest-environment node */
import { jobStatusFromRuns, syncJobStatusFromRuns } from "./job-status-sync";

type Tx = Parameters<typeof syncJobStatusFromRuns>[0];

function fakeTx(active: unknown[], latest: unknown[]) {
  const results = [active, latest];
  const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
  const select = jest.fn(() => {
    const rows = results.shift();
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => Promise.resolve(rows);
    return chain;
  });
  return { tx: { select, update: jest.fn(() => ({ set })) } as unknown as Tx, set };
}

describe("jobStatusFromRuns", () => {
  it("is running while any run is active", () => {
    expect(jobStatusFromRuns(true, "failed")).toBe("running");
  });
  it("follows the newest finished run, not older failures", () => {
    expect(jobStatusFromRuns(false, "passed")).toBe("passed");
  });
  it("is pending with no finished run", () => {
    expect(jobStatusFromRuns(false, undefined)).toBe("pending");
  });
});

describe("syncJobStatusFromRuns", () => {
  it("writes the newest finished run's status after the newer run is deleted", async () => {
    const { tx, set } = fakeTx([], [{ status: "passed" }]);
    await expect(syncJobStatusFromRuns(tx, "job-1")).resolves.toBe("passed");
    expect(set).toHaveBeenCalledWith({ status: "passed" });
  });
  it("keeps running when another run is active", async () => {
    const { tx, set } = fakeTx([{ id: "r2" }], [{ status: "failed" }]);
    await syncJobStatusFromRuns(tx, "job-1");
    expect(set).toHaveBeenCalledWith({ status: "running" });
  });
});

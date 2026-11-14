/** @jest-environment node */
const rows: { key: string }[] = [];
const where = jest.fn(async (..._a: unknown[]) => rows);
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where }) }) } }));

import { monitorSecretNames, validateMonitorSecretRefs } from "./monitor-secret-refs";

beforeEach(() => {
  rows.length = 0;
  where.mockClear();
});

describe("monitorSecretNames", () => {
  it("collects both references and ignores everything else", () => {
    expect(monitorSecretNames({ aiEndpoint: { secretKey: "A" }, auth: { secretKey: "B" } })).toEqual(["A", "B"]);
    expect(monitorSecretNames({ aiEndpoint: { model: "m" }, auth: { type: "bearer", token: "t" } })).toEqual([]);
    expect(monitorSecretNames({ auth: { secretKey: "" } })).toEqual([]);
    expect(monitorSecretNames(null)).toEqual([]);
    expect(monitorSecretNames("x")).toEqual([]);
  });
});

describe("validateMonitorSecretRefs", () => {
  it("skips the lookup when no secret is named", async () => {
    expect(await validateMonitorSecretRefs("p", { method: "GET" })).toEqual({ success: true });
    expect(where).not.toHaveBeenCalled();
  });
  it("succeeds when every distinct name is found, and names the first missing one otherwise", async () => {
    rows.push({ key: "A" }, { key: "B" });
    expect(await validateMonitorSecretRefs("p", { aiEndpoint: { secretKey: "A" }, auth: { secretKey: "A" } })).toEqual({ success: true });
    expect(await validateMonitorSecretRefs("p", { aiEndpoint: { secretKey: "A" }, auth: { secretKey: "C" } })).toEqual({
      success: false,
      error: "Invalid monitor configuration",
      details: "Secret C was not found in this project",
    });
  });
});

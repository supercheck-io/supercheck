jest.mock("@/utils/db", () => ({ db: {} }));
import { mergePatch, monitorNameError, normalizeMonitorAlertConfig } from "./monitor-write";

describe("monitorNameError", () => {
  it("allows an omitted name and rejects a blank, non-string or over-long one", () => {
    expect(monitorNameError(undefined)).toBeNull();
    expect(monitorNameError("API")).toBeNull();
    for (const bad of ["", "   ", null, 5, "x".repeat(256)]) {
      expect(monitorNameError(bad)).toBe("name must be 1-255 characters");
    }
  });
});

describe("normalizeMonitorAlertConfig incidentSeverity", () => {
  it("rejects an unknown severity instead of silently dropping it", () => {
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "sev9" })).toEqual({
      ok: false,
      error: "incidentSeverity must be one of sev1, sev2, sev3, sev4",
    });
  });
  it("keeps a valid severity and tolerates null or empty", () => {
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "sev2" })).toMatchObject({ ok: true, value: { incidentSeverity: "sev2" } });
    expect(normalizeMonitorAlertConfig({ incidentSeverity: null })).toMatchObject({ ok: true });
    expect(normalizeMonitorAlertConfig({ incidentSeverity: "" })).toMatchObject({ ok: true });
  });
});

describe("mergePatch", () => {
  it("merges objects, replaces arrays and scalars, and deletes null keys", () => {
    const target = { a: 1, o: { x: 1, y: 2, deep: { k: 1 } }, list: [1, 2], gone: "x" };
    const out = mergePatch(target, { a: 2, o: { y: null, deep: { z: 3 } }, list: [9], gone: null, fresh: { n: null } });
    expect(out).toEqual({ a: 2, o: { x: 1, deep: { k: 1, z: 3 } }, list: [9], fresh: {} });
    expect(target.o.y).toBe(2); // inputs are not mutated
  });
  it("replaces a scalar with an object patch", () => {
    expect(mergePatch({ o: "s" }, { o: { a: 1 } })).toEqual({ o: { a: 1 } });
  });
});

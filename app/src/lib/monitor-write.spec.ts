jest.mock("@/utils/db", () => ({ db: {} }));
import { monitorNameError, normalizeMonitorAlertConfig } from "./monitor-write";

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

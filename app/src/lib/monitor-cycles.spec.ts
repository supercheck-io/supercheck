/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/db/schema", () => ({ monitorCycles: {} }));
import {
  missingCycleClosureEnabled,
  missingCycleDeadlineMs,
  monitorCycleId,
  monitorCyclePolicy,
} from "./monitor-cycles";

describe("monitor cycle helpers", () => {
  it("is off unless explicitly enabled", () => {
    expect(missingCycleClosureEnabled({})).toBe(false);
    expect(missingCycleClosureEnabled({ MISSING_CYCLE_CLOSURE_ENABLED: "1" })).toBe(false);
    expect(missingCycleClosureEnabled({ MISSING_CYCLE_CLOSURE_ENABLED: "true" })).toBe(true);
  });

  it.each([
    [undefined, undefined, (300 + 60) * 1000],
    ["abc", undefined, (300 + 60) * 1000],
    ["5", undefined, (60 + 60) * 1000],
    ["120", undefined, (120 + 60) * 1000],
    ["99999", undefined, (1800 + 60) * 1000],
    ["300", { timeoutSeconds: 120 }, (300 + 240) * 1000],
    ["300", { timeoutSeconds: 99999 }, (300 + 600) * 1000],
    ["300", { timeoutSeconds: -4 }, (300 + 60) * 1000],
  ])("sizes the deadline for env %j and config %j to %d ms", (value, config, expected) => {
    expect(missingCycleDeadlineMs({ MISSING_CYCLE_DEADLINE_SECONDS: value }, config)).toBe(expected);
  });

  it("derives a stable, BullMQ-safe, per-key id", () => {
    const id = monitorCycleId("m-1", "repeat:hash:1700000000000");
    expect(id).toBe(monitorCycleId("m-1", "repeat:hash:1700000000000"));
    expect(id).not.toContain(":");
    expect(id).not.toBe(monitorCycleId("m-1", "repeat:hash:1700000060000"));
    expect(id).not.toBe(monitorCycleId("m-2", "repeat:hash:1700000000000"));
  });

  it("mirrors the worker aggregation defaults", () => {
    // Without multi-location config the legacy path let the first result decide; cycles use "any".
    expect(monitorCyclePolicy(null)).toEqual({ strategy: "any", threshold: 100 });
    expect(monitorCyclePolicy({ enabled: false, locations: ["eu"], threshold: 10 })).toEqual({ strategy: "any", threshold: 100 });
    expect(monitorCyclePolicy({ enabled: true, locations: [], threshold: 10 })).toEqual({ strategy: "any", threshold: 100 });
    expect(monitorCyclePolicy({ enabled: true, locations: ["eu", "us"], threshold: 67, strategy: "any" })).toEqual({ strategy: "any", threshold: 67 });
    expect(
      monitorCyclePolicy({ enabled: true, locations: ["eu", "us"] } as never),
    ).toEqual({ strategy: "majority", threshold: 50 });
  });
});

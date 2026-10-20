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
    [undefined, 180_000],
    ["abc", 180_000],
    ["5", 30_000],
    ["120", 120_000],
    ["99999", 900_000],
  ])("clamps the deadline %j to %d ms", (value, expected) => {
    expect(missingCycleDeadlineMs({ MISSING_CYCLE_DEADLINE_SECONDS: value })).toBe(expected);
  });

  it("derives a stable, BullMQ-safe, per-key id", () => {
    const id = monitorCycleId("m-1", "repeat:hash:1700000000000");
    expect(id).toBe(monitorCycleId("m-1", "repeat:hash:1700000000000"));
    expect(id).not.toContain(":");
    expect(id).not.toBe(monitorCycleId("m-1", "repeat:hash:1700000060000"));
    expect(id).not.toBe(monitorCycleId("m-2", "repeat:hash:1700000000000"));
  });

  it("mirrors the worker aggregation defaults", () => {
    expect(monitorCyclePolicy(null)).toEqual({ strategy: "all", threshold: 100 });
    expect(monitorCyclePolicy({ enabled: false, locations: ["eu"], threshold: 10 })).toEqual({ strategy: "all", threshold: 100 });
    expect(monitorCyclePolicy({ enabled: true, locations: ["eu", "us"], threshold: 67, strategy: "any" })).toEqual({ strategy: "any", threshold: 67 });
    expect(
      monitorCyclePolicy({ enabled: true, locations: ["eu", "us"] } as never),
    ).toEqual({ strategy: "majority", threshold: 50 });
  });
});

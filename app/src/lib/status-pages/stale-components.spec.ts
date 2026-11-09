import { staleComponentIds } from "./stale-components";

const now = Date.parse("2026-11-09T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000);
const link = (componentId: string, over: Partial<Parameters<typeof staleComponentIds>[0][number]> = {}) => ({
  componentId, enabled: true, status: "up", frequencyMinutes: 1, lastCheckAt: ago(1), ...over,
});

describe("staleComponentIds", () => {
  it("marks a component stale only when every running monitor is overdue", () => {
    expect(staleComponentIds([
      link("stale", { lastCheckAt: ago(16) }),
      link("stale", { lastCheckAt: ago(30), frequencyMinutes: 5 }),
      link("mixed", { lastCheckAt: ago(60) }),
      link("mixed"),
      link("fresh"),
    ], now)).toEqual(new Set(["stale"]));
  });

  it("waits three intervals, and at least 15 minutes", () => {
    expect(staleComponentIds([link("a", { lastCheckAt: ago(14) })], now).size).toBe(0);
    expect(staleComponentIds([link("b", { frequencyMinutes: 10, lastCheckAt: ago(29) })], now).size).toBe(0);
    expect(staleComponentIds([link("c", { frequencyMinutes: 10, lastCheckAt: ago(31) })], now)).toEqual(new Set(["c"]));
  });

  it("keeps the stored status for paused, disabled and never-checked monitors", () => {
    expect(staleComponentIds([
      link("paused", { status: "paused", lastCheckAt: ago(600) }),
      link("disabled", { enabled: false, lastCheckAt: ago(600) }),
      link("new", { lastCheckAt: null }),
    ], now).size).toBe(0);
  });
});

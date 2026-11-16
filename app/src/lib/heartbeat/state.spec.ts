/** @jest-environment node */
import {
  defaultHeartbeatGraceMinutes,
  heartbeatDisplayState,
  heartbeatGraceMinutes,
  heartbeatLastAt,
  heartbeatNextExpectedAt,
  heartbeatSummary,
  HEARTBEAT_MAX_GRACE_MINUTES,
} from "./state";

const CREATED = "2026-01-01T00:00:00.000Z";
const at = (iso: string) => new Date(iso);
const monitor = (overrides: Record<string, unknown> = {}) => ({
  type: "heartbeat",
  status: "up",
  enabled: true,
  frequencyMinutes: 60,
  config: null,
  heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", lastPingKind: "ping" as const },
  createdAt: CREATED,
  ...overrides,
});

describe("heartbeat grace", () => {
  it("defaults to 20% of the interval, at least 5 minutes and at most a day", () => {
    expect(defaultHeartbeatGraceMinutes(1)).toBe(5);
    expect(defaultHeartbeatGraceMinutes(60)).toBe(12);
    expect(defaultHeartbeatGraceMinutes(44640)).toBe(HEARTBEAT_MAX_GRACE_MINUTES);
  });

  it("uses the configured grace when set", () => {
    expect(heartbeatGraceMinutes({ frequencyMinutes: 60, config: { heartbeat: { graceMinutes: 3 } } })).toBe(3);
    expect(heartbeatGraceMinutes({ frequencyMinutes: 60, config: {} })).toBe(12);
  });
});

describe("heartbeat last and next (B20)", () => {
  it("counts from the newer of the last ping and the anchor (create or resume)", () => {
    expect(heartbeatLastAt(monitor())).toBe(at("2026-01-01T10:00:00.000Z").getTime());
    expect(heartbeatLastAt(monitor({ heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", anchorAt: "2026-01-01T11:00:00.000Z" } })))
      .toBe(at("2026-01-01T11:00:00.000Z").getTime());
    expect(heartbeatLastAt(monitor({ heartbeatState: null }))).toBe(at(CREATED).getTime());
    expect(heartbeatLastAt(monitor({ heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z" }, createdAt: null }))).toBe(at("2026-01-01T10:00:00.000Z").getTime());
    expect(heartbeatLastAt(monitor({ heartbeatState: {}, createdAt: "not a date" }))).toBeNull();
  });

  it("expects the next ping one interval after last", () => {
    expect(heartbeatNextExpectedAt(monitor())?.toISOString()).toBe("2026-01-01T11:00:00.000Z");
    expect(heartbeatNextExpectedAt(monitor({ heartbeatState: {}, createdAt: null }))).toBeNull();
  });
});

describe("heartbeatDisplayState (B20)", () => {
  it.each([
    ["paused status", { status: "paused" }, "2026-01-01T10:30:00Z", "paused"],
    ["disabled", { enabled: false }, "2026-01-01T10:30:00Z", "paused"],
    ["down", { status: "down" }, "2026-01-01T10:30:00Z", "down"],
    ["never pinged", { status: "pending", heartbeatState: null }, "2026-01-05T00:00:00Z", "pending"],
    ["up, inside the interval", {}, "2026-01-01T10:59:59Z", "up"],
    ["up, exactly at the deadline", {}, "2026-01-01T11:00:00Z", "up"],
    ["up, overdue", {}, "2026-01-01T11:00:01Z", "late"],
    ["up, overdue but deadline shifted after an app outage", { heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", deadlineShiftMs: 1_800_000 } }, "2026-01-01T11:20:00Z", "up"],
    ["up, past the shifted time", { heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", deadlineShiftMs: 1_800_000 } }, "2026-01-01T11:30:01Z", "late"],
  ])("%s", (_label, overrides, now, expected) => {
    expect(heartbeatDisplayState(monitor(overrides), at(now))).toBe(expected);
  });
});

describe("heartbeatSummary", () => {
  it("is undefined for other monitor types", () => {
    expect(heartbeatSummary(monitor({ type: "http_request" }))).toBeUndefined();
  });

  it("returns the read-only state and never anything token-like", () => {
    const summary = heartbeatSummary(monitor({ heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", lastPingKind: "fail", lastStartAt: "2026-01-01T09:59:00.000Z", pingSeq: 4, lastUserAgent: "curl" } }), at("2026-01-01T10:30:00Z"));
    expect(summary).toEqual({
      state: "up",
      lastPingAt: "2026-01-01T10:00:00.000Z",
      lastPingKind: "fail",
      lastStartAt: "2026-01-01T09:59:00.000Z",
      nextExpectedAt: "2026-01-01T11:00:00.000Z",
      graceMinutes: 12,
    });
    expect(heartbeatSummary(monitor({ heartbeatState: null, createdAt: null }))).toMatchObject({ lastPingAt: null, lastPingKind: null, lastStartAt: null, nextExpectedAt: null });
    // Never pinged but created earlier: anchor + interval would read as overdue, yet it stays pending
    expect(heartbeatSummary(monitor({ status: "pending", heartbeatState: null, createdAt: "2026-01-01T08:00:00.000Z" }))).toMatchObject({ state: "pending", nextExpectedAt: null });
  });
});

import { getDisplayStatus, toDisplayStatus } from "./incident-status-display";

describe("toDisplayStatus", () => {
  it("shows triggered until someone acknowledges it", () => {
    expect(toDisplayStatus("triggered", null)).toBe("triggered");
    expect(toDisplayStatus("triggered", new Date())).toBe("acknowledged");
    expect(toDisplayStatus("triggered", "2026-01-01T00:00:00Z")).toBe("acknowledged");
  });

  it.each([
    ["investigating", "investigating"],
    ["identified", "fixing"],
    ["recommendations_ready", "fixing"],
    ["user_applying_fix", "fixing"],
    ["verifying", "monitoring"],
    ["resolved", "resolved"],
  ] as const)("maps stored %s to %s regardless of acknowledgement", (stored, display) => {
    expect(toDisplayStatus(stored, null)).toBe(display);
    expect(toDisplayStatus(stored, new Date())).toBe(display);
  });
});

describe("getDisplayStatus", () => {
  it("returns the label and tone entry for the display status", () => {
    expect(getDisplayStatus("triggered", null)).toMatchObject({ value: "triggered", label: "Triggered", tone: "danger" });
    expect(getDisplayStatus("triggered", new Date())).toMatchObject({ value: "acknowledged", label: "Acknowledged" });
    expect(getDisplayStatus("verifying", null)).toMatchObject({ value: "monitoring", label: "Monitoring" });
  });
});

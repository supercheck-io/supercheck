import { resolveMonitorDetailStatus } from "./monitor-detail-status";

describe("resolveMonitorDetailStatus", () => {
  it("uses the backend monitor status for the aggregate all-locations view", () => {
    expect(
      resolveMonitorDetailStatus(
        "up",
        [
          { location: "eu-central", isUp: false },
          { location: "us-east", isUp: true },
        ],
        "all"
      )
    ).toBe("up");
  });

  it("returns the selected location status when a region filter is active", () => {
    expect(
      resolveMonitorDetailStatus(
        "up",
        [
          { location: "us-east", isUp: true },
          { location: "eu-central", isUp: false },
        ],
        "eu-central"
      )
    ).toBe("down");
  });

  it("falls back to the backend status when the selected location has no result", () => {
    expect(
      resolveMonitorDetailStatus(
        "paused",
        [{ location: "us-east", isUp: true }],
        "ap-south"
      )
    ).toBe("paused");
  });
});

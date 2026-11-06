jest.mock("@/utils/db", () => ({ db: {} }));
import { StatusAggregationService, type ComponentStatus } from "./status-aggregation.service";
const service = new StatusAggregationService();
it("honors minimum failing monitor count", () => {
  expect(
    service.calculateFromMonitors(
      [
        { status: "down", weight: 1 },
        { status: "up", weight: 1 },
      ],
      "worst_case",
      2,
    ),
  ).toBe("operational");
  expect(
    service.calculateFromMonitors(
      [{ status: "down", weight: 1 }],
      "worst_case",
      1,
    ),
  ).toBe("major_outage");
});
it("uses monitor weights and chooses the worse status on a tied vote", () => {
  expect(
    service.calculateFromMonitors(
      [
        { status: "down", weight: 1 },
        { status: "up", weight: 3 },
      ],
      "weighted_average",
      1,
    ),
  ).toBe("operational");
  expect(
    service.calculateFromMonitors(
      [
        { status: "down", weight: 2 },
        { status: "up", weight: 2 },
      ],
      "weighted_average",
      1,
    ),
  ).toBe("major_outage");
  expect(
    service.calculateFromMonitors(
      [
        { status: "down", weight: 2 },
        { status: "up", weight: 2 },
      ],
      "majority_vote",
      1,
    ),
  ).toBe("major_outage");
});
it("supports best case", () => {
  expect(
    service.calculateFromMonitors(
      [
        { status: "down", weight: 1 },
        { status: "up", weight: 1 },
      ],
      "best_case",
      1,
    ),
  ).toBe("operational");
});
it("ignores pending and paused monitors while another monitor has a real result", () => {
  const calc = (statuses: string[]) =>
    service.calculateFromMonitors(statuses.map((status) => ({ status, weight: 1 })), "worst_case", 1);
  expect(calc(["up", "pending"])).toBe("operational");
  expect(calc(["up", "paused"])).toBe("operational");
  expect(calc(["down", "pending"])).toBe("major_outage");
});
describe("components without a reporting monitor", () => {
  const calc = (statuses: string[], previous?: ComponentStatus) =>
    service.calculateFromMonitors(statuses.map((status) => ({ status, weight: 1 })), "worst_case", 1, previous);
  it("shows a sole pending monitor as operational, whatever the previous status", () => {
    expect(calc(["pending"])).toBe("operational");
    expect(calc(["pending"], "major_outage")).toBe("operational");
  });
  it("keeps the last known status for paused monitors, operational when none", () => {
    expect(calc(["paused"])).toBe("operational");
    expect(calc(["paused"], "degraded_performance")).toBe("degraded_performance");
    expect(calc(["paused", "paused"], "partial_outage")).toBe("partial_outage");
    expect(calc(["paused", "pending"], "operational")).toBe("operational");
  });
  it("does not treat a stored under_maintenance as a last known status", () => {
    expect(calc(["paused"], "under_maintenance")).toBe("operational");
  });
  it("still uses real statuses of a mixed component", () => {
    expect(calc(["paused", "pending", "down"], "operational")).toBe("major_outage");
    expect(calc(["paused", "up"], "major_outage")).toBe("operational");
  });
});

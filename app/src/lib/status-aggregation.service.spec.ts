jest.mock("@/utils/db", () => ({ db: {} }));
import { StatusAggregationService } from "./status-aggregation.service";
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
it("supports best case and maps pending checks to degraded rather than claiming uptime", () => {
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
  expect(
    service.calculateFromMonitors(
      [{ status: "pending", weight: 1 }],
      "worst_case",
      1,
    ),
  ).toBe("degraded_performance");
});
it("ignores pending and paused monitors while another monitor has a real result", () => {
  const calc = (statuses: string[]) =>
    service.calculateFromMonitors(statuses.map((status) => ({ status, weight: 1 })), "worst_case", 1);
  expect(calc(["up", "pending"])).toBe("operational");
  expect(calc(["up", "paused"])).toBe("operational");
  expect(calc(["down", "pending"])).toBe("major_outage");
  expect(calc(["paused"])).toBe("under_maintenance");
});

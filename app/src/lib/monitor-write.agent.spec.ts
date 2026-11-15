const findFirst = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { tests: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
const resolveMonitorLocations = jest.fn();
jest.mock("@/lib/monitor-location-routing", () => ({ resolveMonitorLocations: (...a: unknown[]) => resolveMonitorLocations(...a) }));
const assertAgentTestRunnable = jest.fn();
jest.mock("@/lib/queue", () => ({
  assertAgentTestRunnable: (...a: unknown[]) => assertAgentTestRunnable(...a),
  monitorQueueName: (code: string) => `monitor-${code}`,
}));

import { ExecutionQueueError } from "@/lib/execution-errors";
import { assertAgentMonitorRunnable } from "./monitor-write";

const TEST_ID = "00000000-0000-4000-8000-000000000001";
const monitor = { type: "synthetic_test", projectId: "p1", organizationId: "o1", config: { testId: TEST_ID, locationConfig: { enabled: true, locations: ["eu"] } } } as never;

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue({ type: "agent" });
  resolveMonitorLocations.mockReset().mockResolvedValue(["eu", "us"]);
  assertAgentTestRunnable.mockReset().mockResolvedValue(undefined);
});

describe("assertAgentMonitorRunnable", () => {
  it("checks the queue of every effective location for an agent test", async () => {
    await assertAgentMonitorRunnable(monitor);
    expect(resolveMonitorLocations).toHaveBeenCalledWith({ enabled: true, locations: ["eu"] }, "p1", { monitorType: "synthetic_test" });
    expect(assertAgentTestRunnable).toHaveBeenCalledWith(["monitor-eu", "monitor-us"]);
  });

  it("turns a gate refusal into a retryable 503", async () => {
    assertAgentTestRunnable.mockRejectedValue(new ExecutionQueueError("agent_workers_pending", "Agent tests need updated workers"));
    await expect(assertAgentMonitorRunnable(monitor)).rejects.toEqual({ statusCode: 503, message: "Agent tests need updated workers" });
  });

  it.each([
    ["a browser test", { type: "browser" }],
    ["a missing test (another project or organization)", undefined],
  ])("does not check for %s", async (_name, row) => {
    findFirst.mockResolvedValue(row);
    await assertAgentMonitorRunnable(monitor);
    expect(assertAgentTestRunnable).not.toHaveBeenCalled();
  });

  it("ignores other monitor types without reading the database", async () => {
    await assertAgentMonitorRunnable({ ...(monitor as object), type: "http_request" } as never);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

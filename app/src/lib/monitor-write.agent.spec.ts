const findFirst = jest.fn();
const selectWhere = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { query: { tests: { findFirst: (...a: unknown[]) => findFirst(...a) } }, select: () => ({ from: () => ({ where: (...a: unknown[]) => selectWhere(...a) }) }) },
}));
const resolveMonitorLocations = jest.fn();
jest.mock("@/lib/monitor-location-routing", () => ({
  resolveMonitorLocations: (...a: unknown[]) => resolveMonitorLocations(...a),
  isMonitorLocationResolutionError: (m: string) => m.startsWith("Monitor has locations explicitly configured ["),
}));
const assertAgentTestRunnable = jest.fn();
jest.mock("@/lib/queue", () => ({
  assertAgentTestRunnable: (...a: unknown[]) => assertAgentTestRunnable(...a),
  monitorQueueName: (code: string) => `monitor-${code}`,
}));

import { ExecutionQueueError } from "@/lib/execution-errors";
import { assertAgentMonitorRunnable, assertAgentTestSwitchRunnable, thrownStatusResponse } from "./monitor-write";

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

  it("throws agent_workers_pending, which thrownStatusResponse maps to 503 AGENT_WORKERS_PENDING with Retry-After", async () => {
    assertAgentTestRunnable.mockRejectedValue(new ExecutionQueueError("agent_workers_pending", "Agent tests need updated workers"));
    const error = await assertAgentMonitorRunnable(monitor).catch((e) => e);
    expect(error).toBeInstanceOf(ExecutionQueueError);
    const response = thrownStatusResponse(error);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBeTruthy();
    expect((await response?.json()).code).toBe("AGENT_WORKERS_PENDING");
  });

  it("skips the gate when no configured location is eligible, leaving the config error to the schedule path", async () => {
    resolveMonitorLocations.mockRejectedValue(new Error("Monitor has locations explicitly configured [eu] but none are currently enabled."));
    await expect(assertAgentMonitorRunnable(monitor)).resolves.toBeUndefined();
    expect(assertAgentTestRunnable).not.toHaveBeenCalled();
  });

  it("does not swallow unrelated location errors", async () => {
    resolveMonitorLocations.mockRejectedValue(new Error("db down"));
    await expect(assertAgentMonitorRunnable(monitor)).rejects.toThrow("db down");
  });

  it("gates a test switched to agent without reading the stored type", async () => {
    await assertAgentMonitorRunnable(monitor, true);
    expect(findFirst).not.toHaveBeenCalled();
    expect(assertAgentTestRunnable).toHaveBeenCalled();
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

describe("assertAgentTestSwitchRunnable", () => {
  it("gates each enabled synthetic monitor on the test and refuses when workers are pending", async () => {
    selectWhere.mockResolvedValue([monitor, monitor]);
    await assertAgentTestSwitchRunnable(TEST_ID, "o1", "p1");
    expect(assertAgentTestRunnable).toHaveBeenCalledTimes(2);
    assertAgentTestRunnable.mockRejectedValue(new ExecutionQueueError("agent_workers_pending", "pending"));
    await expect(assertAgentTestSwitchRunnable(TEST_ID, "o1", "p1")).rejects.toBeInstanceOf(ExecutionQueueError);
  });

  it("passes when no monitor uses the test", async () => {
    selectWhere.mockResolvedValue([]);
    await assertAgentTestSwitchRunnable(TEST_ID, "o1", "p1");
    expect(assertAgentTestRunnable).not.toHaveBeenCalled();
  });
});

/** @jest-environment node */
const limit = jest.fn();
const select = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }));
import { isAgentRun } from "./run-is-agent";

const TEST_ID = "00000000-0000-4000-8000-000000000001";
const outer = { from: () => ({ where: () => ({ limit }) }) };
beforeEach(() => {
  limit.mockReset().mockResolvedValue([]);
  select.mockReset().mockReturnValue({ ...outer, from: () => ({ where: () => ({ limit }) }) });
});

describe("isAgentRun", () => {
  it("is false without a job or a test id, and never queries", async () => {
    expect(await isAgentRun({ jobId: null, testId: null, projectId: "p" })).toBe(false);
    expect(await isAgentRun({ jobId: null, testId: "not-a-uuid", projectId: "p" })).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
  it("is true when the project has a matching agent test, false otherwise", async () => {
    limit.mockResolvedValueOnce([{ id: TEST_ID }]);
    expect(await isAgentRun({ jobId: null, testId: TEST_ID, projectId: "p" })).toBe(true);
    expect(await isAgentRun({ jobId: null, testId: TEST_ID, projectId: "p" })).toBe(false);
  });
  it("checks job members with a subquery", async () => {
    limit.mockResolvedValueOnce([{ id: TEST_ID }]);
    expect(await isAgentRun({ jobId: "j", projectId: "p" })).toBe(true);
    expect(select).toHaveBeenCalledTimes(2); // the member subquery plus the test lookup
  });
});

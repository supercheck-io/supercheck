jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn(async () => ({ user: { id: "user" } })), getUserRole: jest.fn(async () => "project_viewer"), hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/agent-test/run-is-agent", () => ({ isAgentRun: jest.fn(async () => true) }));
import { db } from "@/utils/db";
import { isAgentRun } from "@/lib/agent-test/run-is-agent";
import { projects } from "@/db/schema";
import { hasPermissionForUser, requireAuth, getUserRole } from "@/lib/rbac/middleware";
import { getRun } from "./get-runs";

describe("run history authorization", () => {
  const run = { id: "run", jobId: null, projectId: "project", organizationId: "org", status: "passed", startedAt: new Date() };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireAuth).mockResolvedValue({ userId: "user", user: { id: "user" } } as never);
    jest.mocked(getUserRole).mockResolvedValue("project_viewer" as never);
    const query = { from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [run]) };
    jest.mocked(db.select).mockReturnValue(query as never);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
  });
  it("derives ownership from the project and authorizes playground runs with no job", async () => {
    expect(await getRun("run")).not.toBeNull();
    expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ organizationId: projects.organizationId, projectId: projects.id }));
    expect(hasPermissionForUser).toHaveBeenCalledWith("user", "run", "view", { organizationId: "org", projectId: "project" });
  });
  it("returns the server-computed isAgentRun, scoped to the run's project and test", async () => {
    jest.mocked(db.select).mockReturnValue({ from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [{ ...run, metadata: { testId: "t1", testType: "agent" } }]) } as never);
    expect((await getRun("run"))?.isAgentRun).toBe(true);
    expect(isAgentRun).toHaveBeenCalledWith({ jobId: null, testId: "t1", testType: "agent", projectId: "project" });
  });
  it("titles a single-test run after its test and counts that one test", async () => {
    jest.mocked(db.select).mockReturnValue({ from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [{ ...run, testTitle: "Support bot", metadata: { testId: "t1" } }]) } as never);
    expect(await getRun("run")).toMatchObject({ jobId: null, jobName: "Support bot", testCount: 1 });
  });
  it("counts no tests for a run with neither job nor test", async () => {
    expect(await getRun("run")).toMatchObject({ jobName: undefined, testCount: 0 });
  });
  it("does not expose a run to a user without project permission", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    await expect(getRun("run")).rejects.toThrow("Failed to fetch run");
  });
});

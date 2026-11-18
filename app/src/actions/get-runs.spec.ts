jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/rbac/middleware", () => ({ requireAuth: jest.fn(async () => ({ user: { id: "user" } })), getUserRole: jest.fn(async () => "project_viewer"), hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/agent-test/run-is-agent", () => ({ isAgentRun: jest.fn(async () => true) }));
import { db } from "@/utils/db";
import { isAgentRun } from "@/lib/agent-test/run-is-agent";
import { projects, tests } from "@/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";
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
  it.each([["performance", "k6"], ["browser", undefined]])("gives a single %s test run jobType %p", async (testType, jobType) => {
    jest.mocked(db.select).mockReturnValue({ from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [{ ...run, jobType: null, testTitle: "Rates", metadata: { testId: "t1", testType } }]) } as never);
    expect((await getRun("run"))?.jobType).toBe(jobType);
  });
  it("counts an unsaved playground test and gives it a title", async () => {
    jest.mocked(db.select).mockReturnValue({ from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [{ ...run, testTitle: null, metadata: { testId: "unsaved" } }]) } as never);
    expect(await getRun("run")).toMatchObject({ jobName: "Playground test", testCount: 1 });
  });
  it("joins the test by uuid so the primary key index is usable, and ignores malformed metadata", async () => {
    const leftJoin = jest.fn().mockReturnThis();
    jest.mocked(db.select).mockReturnValue({ from: jest.fn().mockReturnThis(), leftJoin, where: jest.fn().mockReturnThis(), limit: jest.fn(async () => [run]) } as never);
    await getRun("run");
    const condition = leftJoin.mock.calls.find(([table]) => table === tests)?.[1];
    const { sql: text } = new PgDialect().sqlToQuery(condition);
    expect(text).not.toContain("::text");
    expect(text).toContain("::uuid");
    expect(text).toContain("~*");
    expect(text).toContain("project_id");
  });
  it("counts no tests for a run with neither job nor test", async () => {
    expect(await getRun("run")).toMatchObject({ jobName: undefined, testCount: 0 });
  });
  it("does not expose a run to a user without project permission", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    await expect(getRun("run")).rejects.toThrow("Failed to fetch run");
  });
});

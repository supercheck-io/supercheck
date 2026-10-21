import { deleteRun } from "./delete-run";
import { deleteJob } from "./delete-job";
import { deleteMonitor } from "./delete-monitor";

const mockDeleteReports = jest.fn();
const mockPermission = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({ userId: "user", organizationId: "org", project: { id: "project", name: "Project" } }),
  isAuthError: () => false,
}));
jest.mock("@/lib/server-actions/update-job", () => ({ updateJob: jest.fn() }));
jest.mock("@/lib/queue", () => ({}));
import { DELETE as deleteRunApi } from "@/app/api/runs/[runId]/route";
import { DELETE as deleteJobApi } from "@/app/api/jobs/[id]/route";
import { DELETE as deleteMonitorApi } from "@/app/api/monitors/[id]/route";

const mockDelete = jest.fn();
const mockRunInputs = jest.fn();
const mockSelections: unknown[][] = [];

jest.mock("@/utils/db", () => ({
  db: {
    transaction: jest.fn(async (work) => work({
      select: jest.fn(() => {
        const rows = mockSelections.shift() ?? [];
        return { from: () => ({ where: () => ({
          limit: async () => rows,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        }) }) };
      }),
      delete: (...args: unknown[]) => mockDelete(...args),
    })),
  },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: async () => ({ userId: "user", organizationId: "org", project: { id: "project", name: "Project" } }),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...args: unknown[]) => mockPermission(...args) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({
  createS3CleanupService: () => ({ getRunArtifactInputs: (...args: unknown[]) => mockRunInputs(...args), deleteReports: (...args: unknown[]) => mockDeleteReports(...args) }),
}));

describe("explicit artifact deletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelections.length = 0;
    mockRunInputs.mockReturnValue([]);
    mockPermission.mockReturnValue(true);
    mockDelete.mockReturnValue({ where: () => ({ returning: async () => [{ id: "deleted" }] }) });
  });

  it.each([
    ["run", deleteRun, [{ id: "run", status: "passed", startedAt: null }, [{ id: "report", reportPath: "run/report", entityType: "job" }]]],
    ["job", deleteJob, [{ id: "job", name: "Job" }, [{ id: "report", reportPath: "run/report", entityType: "job", entityId: "run" }], []]],
    ["monitor", deleteMonitor, [{ id: "monitor", name: "Monitor" }, [{ id: "result", testExecutionId: "execution", testReportS3Url: null }]]],
    ["REST run", async (id: string) => (await deleteRunApi(new Request("http://localhost"), { params: Promise.resolve({ runId: id }) })).json(), [{ id: "run", status: "passed", startedAt: null }, [{ id: "report", reportPath: "run/report", entityType: "job" }]]],
    ["REST job", async (id: string) => (await deleteJobApi(new Request("http://localhost"), { params: Promise.resolve({ id }) })).json(), [{ id: "job", name: "Job" }, [{ id: "report", reportPath: "run/report", entityType: "job", entityId: "run" }], []]],
    ["REST monitor", async (id: string) => (await deleteMonitorApi(new Request("http://localhost"), { params: Promise.resolve({ id }) })).json(), [{ id: "monitor", name: "Monitor" }, [{ id: "result", testExecutionId: "execution", testReportS3Url: null }]]],
  ] as const)("retains %s pointers after a partial storage failure", async (_name, remove, selections) => {
    for (const rows of selections) mockSelections.push(Array.isArray(rows) ? [...rows] : [rows]);
    mockDeleteReports.mockResolvedValue({ success: false, deletedObjects: ["partial"], failedObjects: [{ key: "remaining", error: "unavailable" }] });

    const result = await remove("resource");

    expect(result.success).toBe(false);
    expect(mockDeleteReports).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("rejects an active run before touching storage or database rows", async () => {
    mockSelections.push([{ id: "run", status: "running" }]);
    expect((await deleteRun("run")).success).toBe(false);
    expect(mockDeleteReports).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("rejects a job with active runs before storage cleanup", async () => {
    mockSelections.push([{ id: "job", name: "Job" }], [], [{ id: "run", status: "queued" }]);
    expect((await deleteJob("job")).success).toBe(false);
    expect(mockDeleteReports).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("retains and retries run URL pointers when the report row is absent", async () => {
    const run = { id: "run", status: "passed", startedAt: null, reportS3Url: "http://storage/k6-tests/run/report/index.html" };
    const input = { entityId: "run", entityType: "k6_test", reportPath: "run", s3Url: run.reportS3Url };
    mockRunInputs.mockReturnValue([input]);
    mockSelections.push([run], []);
    mockDeleteReports.mockResolvedValueOnce({ success: false, deletedObjects: [], failedObjects: [{ key: "run", error: "offline" }] });
    expect((await deleteRun("run")).success).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
    mockSelections.push([run], []);
    mockDeleteReports.mockResolvedValueOnce({ success: true, deletedObjects: ["run/report/index.html"], failedObjects: [] });
    expect((await deleteRun("run")).success).toBe(true);
    expect(mockDeleteReports).toHaveBeenNthCalledWith(2, [input]);
    expect(mockDelete).toHaveBeenCalled();
  });

  it("keeps REST permission and active-run status responses", async () => {
    mockPermission.mockReturnValue(false);
    expect((await deleteRunApi(new Request("http://localhost"), { params: Promise.resolve({ runId: "run" }) })).status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
    mockPermission.mockReturnValue(true);
    mockSelections.push([{ id: "run", status: "running" }]);
    expect((await deleteRunApi(new Request("http://localhost"), { params: Promise.resolve({ runId: "run" }) })).status).toBe(409);
    mockSelections.push([]);
    expect((await deleteRunApi(new Request("http://localhost"), { params: Promise.resolve({ runId: "missing" }) })).status).toBe(404);
  });

});

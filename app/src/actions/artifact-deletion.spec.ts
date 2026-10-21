import { deleteRun } from "./delete-run";
import { deleteJob } from "./delete-job";
import { deleteMonitor } from "./delete-monitor";

const mockDeleteReports = jest.fn();
const mockDelete = jest.fn();
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
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn() }));
jest.mock("@/lib/monitor-scheduler", () => ({ deleteScheduledMonitor: jest.fn() }));
jest.mock("@/lib/s3-cleanup", () => ({
  createS3CleanupService: () => ({ deleteReports: (...args: unknown[]) => mockDeleteReports(...args) }),
}));

describe("explicit artifact deletion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelections.length = 0;
    mockDelete.mockReturnValue({ where: () => ({ returning: async () => [{ id: "deleted" }] }) });
  });

  it.each([
    ["run", deleteRun, [{ id: "run", status: "passed", startedAt: null }, [{ id: "report", reportPath: "run/report", entityType: "job" }]]],
    ["job", deleteJob, [{ id: "job", name: "Job" }, [{ id: "report", reportPath: "run/report", entityType: "job", entityId: "run" }], []]],
    ["monitor", deleteMonitor, [{ id: "monitor", name: "Monitor" }, [{ id: "result", testExecutionId: "execution", testReportS3Url: null }]]],
  ] as const)("retains %s pointers after a partial storage failure", async (_name, remove, selections) => {
    for (const rows of selections) mockSelections.push(Array.isArray(rows) ? [...rows] : [rows]);
    mockDeleteReports.mockResolvedValue({ success: false, deletedObjects: ["partial"], failedObjects: [{ key: "remaining", error: "unavailable" }] });

    const result = await remove("resource");

    expect(result.success).toBe(false);
    expect(mockDeleteReports).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

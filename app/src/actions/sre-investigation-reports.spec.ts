/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      sreInvestigationReports: { findFirst: jest.fn() },
    },
    insert: jest.fn(),
    transaction: jest.fn(),
  },
}));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));
jest.mock("@/lib/sre/investigation-queries", () => ({
  getSreInvestigationReportExportForRun: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { db } from "@/utils/db";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getSreInvestigationReportExportForRun } from "@/lib/sre/investigation-queries";
import {
  createSreInvestigationReportSnapshot,
  saveSreInvestigationReportFeedback,
} from "./sre-investigation-reports";

const mockDb = db as jest.Mocked<typeof db>;
const mockRequireProjectContext = requireProjectContext as jest.Mock;
const mockCheckPermission = checkPermissionWithContext as jest.Mock;
const mockGetReport = getSreInvestigationReportExportForRun as jest.Mock;
const mockLogAuditEvent = logAuditEvent as jest.Mock;

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod" },
};
const runId = "018f0000-0000-7000-8000-000000000004";
const reportId = "018f0000-0000-7000-8000-000000000005";
const incidentId = "018f0000-0000-7000-8000-000000000006";

const reportExport = {
  version: "sre-investigation-report.v1",
  exportedAt: "2026-07-30T10:00:00.000Z",
  incident: { id: incidentId, number: 42, title: "Checkout latency" },
  run: {
    agentType: "investigation",
    rootCauseHypothesis: "Dependency latency",
  },
  provenance: { evidenceCount: 2, toolCallCount: 1, recommendationCount: 1 },
};

describe("SRE investigation report actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermission.mockReturnValue(true);
    mockGetReport.mockResolvedValue({ reportExport });
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it("denies snapshot creation before reading report data when RBAC fails", async () => {
    mockCheckPermission.mockReturnValue(false);

    const result = await createSreInvestigationReportSnapshot({ investigationRunId: runId });

    expect(result).toEqual({
      success: false,
      error: "Insufficient permissions to save SRE investigation reports",
    });
    expect(mockGetReport).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("reuses the active snapshot when report content is unchanged", async () => {
    (mockDb.query.sreInvestigationReports.findFirst as jest.Mock).mockResolvedValue({
      id: reportId,
      createdAt: new Date("2026-07-30T10:05:00.000Z"),
    });

    const result = await createSreInvestigationReportSnapshot({ investigationRunId: runId });

    expect(result).toEqual({
      success: true,
      snapshotId: reportId,
      createdAt: "2026-07-30T10:05:00.000Z",
      reused: true,
    });
    expect(mockGetReport).toHaveBeenCalledWith({
      organizationId: context.organizationId,
      projectId: context.project.id,
      investigationRunId: runId,
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects feedback for a snapshot outside the active project", async () => {
    (mockDb.query.sreInvestigationReports.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await saveSreInvestigationReportFeedback({
      reportSnapshotId: reportId,
      accuracy: "incorrect",
      rejectedHypotheses: [],
    });

    expect(result).toEqual({
      success: false,
      error: "SRE investigation report snapshot not found",
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("upserts normalized feedback for the current user", async () => {
    (mockDb.query.sreInvestigationReports.findFirst as jest.Mock).mockResolvedValue({
      id: reportId,
      incidentId,
      investigationRunId: runId,
    });
    const returning = jest.fn().mockResolvedValue([
      {
        id: "018f0000-0000-7000-8000-000000000007",
        accuracy: "partially_accurate",
        rejectedHypotheses: ["Cache saturation"],
        updatedAt: new Date("2026-07-30T10:10:00.000Z"),
      },
    ]);
    const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    (mockDb.insert as jest.Mock).mockReturnValue({ values });

    const result = await saveSreInvestigationReportFeedback({
      reportSnapshotId: reportId,
      accuracy: "partially_accurate",
      notes: "  Verified   against deployment history  ",
      rejectedHypotheses: [" Cache   saturation ", "Cache saturation"],
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: context.organizationId,
        projectId: context.project.id,
        reportId,
        createdByUserId: context.userId,
        notes: "Verified against deployment history",
        rejectedHypotheses: ["Cache saturation"],
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      feedbackId: "018f0000-0000-7000-8000-000000000007",
      accuracy: "partially_accurate",
      rejectedHypothesisCount: 1,
      updatedAt: "2026-07-30T10:10:00.000Z",
    });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sre_investigation_report_feedback_saved",
        resourceId: reportId,
      }),
    );
  });
});

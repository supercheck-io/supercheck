"use server";

import { createHash } from "crypto";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sreInvestigationReports } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getSreInvestigationReportExportForRun } from "@/lib/sre/investigation-queries";
import type { SreInvestigationReportExport } from "@/lib/sre/investigation-report-export";
import { db } from "@/utils/db";

const createSnapshotSchema = z.object({
  investigationRunId: z.string().uuid(),
});

function hashReportContent(report: unknown) {
  const stableReport = typeof report === "object" && report !== null
    ? { ...report, exportedAt: "[excluded-from-content-hash]" }
    : report;

  return createHash("sha256").update(JSON.stringify(stableReport)).digest("hex");
}

function getSnapshotTitle(report: SreInvestigationReportExport) {
  const incidentPrefix = report.incident.number ? `#${report.incident.number}` : "SRE investigation";
  const title = [incidentPrefix, report.incident.title ?? report.run.rootCauseHypothesis ?? report.run.agentType].filter(Boolean).join(" ");
  return title.length > 300 ? `${title.slice(0, 297)}...` : title;
}

export async function createSreInvestigationReportSnapshot(input: z.input<typeof createSnapshotSchema>) {
  const parsed = createSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid SRE investigation report request" };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false as const, error: "Insufficient permissions to save SRE investigation reports" };
    }

    const reportBundle = await getSreInvestigationReportExportForRun({
      organizationId,
      projectId: project.id,
      investigationRunId: parsed.data.investigationRunId,
    });

    if (!reportBundle) {
      return { success: false as const, error: "SRE investigation run not found" };
    }

    const report = reportBundle.reportExport;
    const reportHash = hashReportContent(report);
    const existingSnapshot = await db.query.sreInvestigationReports.findFirst({
      where: and(
        eq(sreInvestigationReports.organizationId, organizationId),
        eq(sreInvestigationReports.projectId, project.id),
        eq(sreInvestigationReports.investigationRunId, parsed.data.investigationRunId),
        eq(sreInvestigationReports.reportHash, reportHash),
        eq(sreInvestigationReports.status, "active")
      ),
      columns: { id: true, createdAt: true },
    });

    if (existingSnapshot) {
      return {
        success: true as const,
        snapshotId: existingSnapshot.id,
        createdAt: existingSnapshot.createdAt.toISOString(),
        reused: true,
      };
    }

    const snapshot = await db.transaction(async (tx) => {
      await tx
        .update(sreInvestigationReports)
        .set({ status: "superseded" })
        .where(
          and(
            eq(sreInvestigationReports.organizationId, organizationId),
            eq(sreInvestigationReports.projectId, project.id),
            eq(sreInvestigationReports.investigationRunId, parsed.data.investigationRunId),
            eq(sreInvestigationReports.status, "active")
          )
        );

      const [inserted] = await tx
        .insert(sreInvestigationReports)
        .values({
          organizationId,
          projectId: project.id,
          incidentId: report.run.agentType === "sre_ai" ? null : report.incident.id,
          investigationRunId: parsed.data.investigationRunId,
          reportVersion: report.version,
          title: getSnapshotTitle(report),
          summary: report.run.rootCauseHypothesis,
          reportData: report as unknown as Record<string, unknown>,
          reportHash,
          status: "active",
          createdByUserId: userId,
        })
        .returning({ id: sreInvestigationReports.id, createdAt: sreInvestigationReports.createdAt });

      return inserted;
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_investigation_report_snapshot_created",
      resource: "sre_investigation_report",
      resourceId: snapshot.id,
      metadata: {
        projectId: project.id,
        investigationRunId: parsed.data.investigationRunId,
        incidentId: report.incident.id,
        reportHash,
        evidenceCount: report.provenance.evidenceCount,
        toolCallCount: report.provenance.toolCallCount,
        recommendationCount: report.provenance.recommendationCount,
      },
      success: true,
    });

    revalidatePath("/incidents");
    if (report.incident.id) {
      revalidatePath(`/incidents/${report.incident.id}`);
    }

    return {
      success: true as const,
      snapshotId: snapshot.id,
      createdAt: snapshot.createdAt.toISOString(),
      reused: false,
    };
  } catch (error) {
    console.error("Error saving SRE investigation report snapshot:", error);
    return { success: false as const, error: "Failed to save SRE investigation report" };
  }
}

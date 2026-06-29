"use server";

import { createHash } from "crypto";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sreInvestigationReportFeedback, sreInvestigationReports } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { getSreInvestigationReportExportForRun } from "@/lib/sre/investigation-queries";
import type { SreInvestigationReportExport } from "@/lib/sre/investigation-report-export";
import { db } from "@/utils/db";

const createSnapshotSchema = z.object({
  investigationRunId: z.string().uuid(),
});

const feedbackAccuracySchema = z.enum(["accurate", "partially_accurate", "incorrect", "needs_more_evidence"]);

const saveFeedbackSchema = z.object({
  reportSnapshotId: z.string().uuid(),
  accuracy: feedbackAccuracySchema,
  notes: z.string().max(2_000).optional(),
  rejectedHypotheses: z.array(z.string().min(1).max(300)).max(10).default([]),
});

function normalizeFeedbackText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFeedbackNotes(value: string | undefined) {
  const normalized = normalizeFeedbackText(value ?? "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeRejectedHypotheses(values: string[]) {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = normalizeFeedbackText(value);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique).slice(0, 10);
}

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

    revalidatePath("/sre-ai/investigations");
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

export async function saveSreInvestigationReportFeedback(input: z.input<typeof saveFeedbackSchema>) {
  const parsed = saveFeedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid SRE investigation report feedback" };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false as const, error: "Insufficient permissions to review SRE investigation reports" };
    }

    const report = await db.query.sreInvestigationReports.findFirst({
      where: and(
        eq(sreInvestigationReports.id, parsed.data.reportSnapshotId),
        eq(sreInvestigationReports.organizationId, organizationId),
        eq(sreInvestigationReports.projectId, project.id)
      ),
      columns: {
        id: true,
        incidentId: true,
        investigationRunId: true,
      },
    });

    if (!report) {
      return { success: false as const, error: "SRE investigation report snapshot not found" };
    }

    const rejectedHypotheses = normalizeRejectedHypotheses(parsed.data.rejectedHypotheses);
    const notes = normalizeFeedbackNotes(parsed.data.notes);
    const [feedback] = await db
      .insert(sreInvestigationReportFeedback)
      .values({
        organizationId,
        projectId: project.id,
        reportId: report.id,
        incidentId: report.incidentId,
        investigationRunId: report.investigationRunId,
        accuracy: parsed.data.accuracy,
        rejectedHypotheses,
        notes,
        createdByUserId: userId,
      })
      .onConflictDoUpdate({
        target: [sreInvestigationReportFeedback.reportId, sreInvestigationReportFeedback.createdByUserId],
        set: {
          accuracy: parsed.data.accuracy,
          rejectedHypotheses,
          notes,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: sreInvestigationReportFeedback.id,
        accuracy: sreInvestigationReportFeedback.accuracy,
        rejectedHypotheses: sreInvestigationReportFeedback.rejectedHypotheses,
        updatedAt: sreInvestigationReportFeedback.updatedAt,
      });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_investigation_report_feedback_saved",
      resource: "sre_investigation_report",
      resourceId: report.id,
      metadata: {
        projectId: project.id,
        investigationRunId: report.investigationRunId,
        incidentId: report.incidentId,
        feedbackId: feedback.id,
        accuracy: feedback.accuracy,
        rejectedHypothesisCount: feedback.rejectedHypotheses.length,
        hasNotes: Boolean(notes),
      },
      success: true,
    });

    revalidatePath("/sre-ai/investigations");
    if (report.incidentId) {
      revalidatePath(`/incidents/${report.incidentId}`);
    }

    return {
      success: true as const,
      feedbackId: feedback.id,
      accuracy: feedback.accuracy,
      rejectedHypothesisCount: feedback.rejectedHypotheses.length,
      updatedAt: feedback.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error("Error saving SRE investigation report feedback:", error);
    return { success: false as const, error: "Failed to save SRE investigation report feedback" };
  }
}

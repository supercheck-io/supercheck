import { and, desc, eq, gte, isNotNull, ne } from "drizzle-orm";

import {
  sreIncidents,
  sreInvestigationFeedback,
  sreInvestigationRuns,
} from "@/db/schema";
import { MAX_FEEDBACK_NOTE_LENGTH, normalizeFeedbackNote } from "@/lib/sre/feedback-note";
import { readStoredHypotheses } from "@/sre/lib/investigation-output";
import { db } from "@/utils/db";

export { MAX_FEEDBACK_NOTE_LENGTH, normalizeFeedbackNote };
const HINT_WINDOW_DAYS = 90;

export type FeedbackActor = {
  userId: string;
  organizationId: string;
  projectId: string;
};

export type FeedbackVerdict = "right" | "wrong";

export type SubmitFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * Stores a Right/Wrong verdict for a run or one of its hypotheses. The run must
 * belong to the caller's organization and project and to an incident.
 */
export async function submitInvestigationFeedback(
  actor: FeedbackActor,
  input: {
    investigationRunId: string;
    hypothesisKey: string | null;
    verdict: FeedbackVerdict;
    note: string | null;
  },
): Promise<SubmitFeedbackResult> {
  const [run] = await db
    .select({
      id: sreInvestigationRuns.id,
      incidentId: sreInvestigationRuns.incidentId,
      hypotheses: sreInvestigationRuns.hypotheses,
      status: sreInvestigationRuns.status,
    })
    .from(sreInvestigationRuns)
    .where(
      and(
        eq(sreInvestigationRuns.id, input.investigationRunId),
        eq(sreInvestigationRuns.organizationId, actor.organizationId),
        eq(sreInvestigationRuns.projectId, actor.projectId),
        eq(sreInvestigationRuns.agentType, "investigation"),
      ),
    )
    .limit(1);
  if (!run || !run.incidentId) return { ok: false, error: "Investigation not found" };
  if (run.status !== "completed") return { ok: false, error: "Feedback is available once the investigation completes" };
  if (
    input.hypothesisKey &&
    !readStoredHypotheses(run.hypotheses).some((hypothesis) => hypothesis.key === input.hypothesisKey)
  ) {
    return { ok: false, error: "Hypothesis not found" };
  }

  await db.insert(sreInvestigationFeedback).values({
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    incidentId: run.incidentId,
    investigationRunId: run.id,
    hypothesisKey: input.hypothesisKey,
    userId: actor.userId,
    verdict: input.verdict,
    note: normalizeFeedbackNote(input.note),
  });
  return { ok: true };
}

export type MyFeedback = { hypothesisKey: string | null; verdict: FeedbackVerdict; note: string | null };

/** The caller's latest verdict per target (run or hypothesis) for one run. */
export async function listMyFeedbackForRun(
  actor: FeedbackActor,
  investigationRunId: string,
): Promise<MyFeedback[]> {
  const rows = await db
    .select({
      hypothesisKey: sreInvestigationFeedback.hypothesisKey,
      verdict: sreInvestigationFeedback.verdict,
      note: sreInvestigationFeedback.note,
    })
    .from(sreInvestigationFeedback)
    .where(
      and(
        eq(sreInvestigationFeedback.investigationRunId, investigationRunId),
        eq(sreInvestigationFeedback.organizationId, actor.organizationId),
        eq(sreInvestigationFeedback.projectId, actor.projectId),
        eq(sreInvestigationFeedback.userId, actor.userId),
      ),
    )
    .orderBy(desc(sreInvestigationFeedback.createdAt))
    .limit(50);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.hypothesisKey ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type FeedbackNote = { verdict: FeedbackVerdict; note: string; target: string | null };

/** Recent notes on this incident's own investigations, newest first (for "re-run with my note"). */
export async function listIncidentFeedbackNotes(
  scope: { organizationId: string; projectId: string; incidentId: string },
  limit = 5,
): Promise<FeedbackNote[]> {
  const rows = await db
    .select({
      verdict: sreInvestigationFeedback.verdict,
      note: sreInvestigationFeedback.note,
      hypothesisKey: sreInvestigationFeedback.hypothesisKey,
      hypotheses: sreInvestigationRuns.hypotheses,
    })
    .from(sreInvestigationFeedback)
    .innerJoin(sreInvestigationRuns, eq(sreInvestigationRuns.id, sreInvestigationFeedback.investigationRunId))
    .where(
      and(
        eq(sreInvestigationFeedback.incidentId, scope.incidentId),
        eq(sreInvestigationFeedback.organizationId, scope.organizationId),
        eq(sreInvestigationFeedback.projectId, scope.projectId),
        isNotNull(sreInvestigationFeedback.note),
      ),
    )
    .orderBy(desc(sreInvestigationFeedback.createdAt))
    .limit(limit);
  return rows.flatMap((row) =>
    row.note
      ? [{
          verdict: row.verdict,
          note: row.note,
          target:
            readStoredHypotheses(row.hypotheses).find((h) => h.key === row.hypothesisKey)?.title ?? null,
        }]
      : [],
  );
}

/** Notes from other incidents of the same service in the last 90 days, used as hints. */
export async function listServiceFeedbackHints(
  scope: { organizationId: string; projectId: string; serviceId: string; excludeIncidentId: string },
  limit = 5,
): Promise<FeedbackNote[]> {
  const since = new Date(Date.now() - HINT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      verdict: sreInvestigationFeedback.verdict,
      note: sreInvestigationFeedback.note,
      hypothesisKey: sreInvestigationFeedback.hypothesisKey,
      hypotheses: sreInvestigationRuns.hypotheses,
    })
    .from(sreInvestigationFeedback)
    .innerJoin(sreInvestigationRuns, eq(sreInvestigationRuns.id, sreInvestigationFeedback.investigationRunId))
    .innerJoin(sreIncidents, eq(sreIncidents.id, sreInvestigationFeedback.incidentId))
    .where(
      and(
        eq(sreInvestigationFeedback.organizationId, scope.organizationId),
        eq(sreInvestigationFeedback.projectId, scope.projectId),
        eq(sreIncidents.organizationId, scope.organizationId),
        eq(sreIncidents.projectId, scope.projectId),
        eq(sreIncidents.primaryServiceId, scope.serviceId),
        ne(sreInvestigationFeedback.incidentId, scope.excludeIncidentId),
        isNotNull(sreInvestigationFeedback.note),
        gte(sreInvestigationFeedback.createdAt, since),
      ),
    )
    .orderBy(desc(sreInvestigationFeedback.createdAt))
    .limit(limit);
  return rows
    .filter((row) => row.note)
    .map((row) => ({
      verdict: row.verdict,
      note: row.note as string,
      target: readStoredHypotheses(row.hypotheses).find((h) => h.key === row.hypothesisKey)?.title ?? null,
    }));
}

export function feedbackPromptLines(notes: FeedbackNote[]): string[] {
  return notes.map(
    (entry) =>
      `${entry.verdict === "wrong" ? "marked wrong" : "marked right"}${entry.target ? ` (${entry.target})` : ""}: ${entry.note}`,
  );
}

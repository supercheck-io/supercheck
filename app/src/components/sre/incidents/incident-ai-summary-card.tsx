"use client";

import { ArrowRight, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { reportHeadline } from "@/lib/sre/evidence-brief-summary";
import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

type IncidentAiSummaryCardProps = {
  rootCauseSummary: string | null;
  /** Decimal string from the database (0-1). */
  confidenceScore: string | null;
  investigationStatus: "running" | "completed" | "failed" | "aborted" | "timed_out" | null;
  /** Latest investigation run; enables live progress and failure details. */
  investigation?: SreIncidentDetail["latestInvestigation"];
  /** Whole-investigation feedback control, shown at the right of the footer. */
  feedback?: React.ReactNode;
  /** Switches to the Investigation tab. */
  onOpenInvestigation?: () => void;
  /** Run controls shown when nothing has been analysed yet, so the first run starts from the card. */
  runControls?: React.ReactNode;
  /** What produced the text: only an investigation carries a confidence rating. */
  source?: "investigation" | "brief" | "triage";
};

const SOURCE_LABEL = { brief: "From the evidence brief", triage: "From AI triage" } as const;

export function confidenceLabel(score: string | null): {
  label: "High" | "Medium" | "Low" | "Inconclusive";
  tone: TableBadgeTone;
} {
  const value = score === null ? NaN : Number(score);
  if (!Number.isFinite(value)) return { label: "Inconclusive", tone: "slate" };
  if (value >= 0.75) return { label: "High", tone: "success" };
  if (value >= 0.5) return { label: "Medium", tone: "warning" };
  if (value > 0) return { label: "Low", tone: "danger" };
  return { label: "Inconclusive", tone: "slate" };
}


// Older free-text reports open with a title or Overview heading, then field lines that repeat the page header.
const REPORT_TITLE = /^\s*(?:#{1,4}\s*)?(?:\*\*)?(?:incident (?:investigation )?report|overview|report details)(?:\*\*)?:?\s*$/i;
const HEADER_FIELD =
  /^\s*[-*]?\s*\*\*(?:incident(?: title)?|title|severity|status|primary service|evidence source|evidence items|primary signal)(?::\*\*|\*\*:).*$|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/i;

/** Drops a leading report header (title, severity, status, service); a summary that starts with a finding is kept whole. */
export function stripReportBoilerplate(text: string) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && !lines[start]!.trim()) start += 1;
  if (start >= lines.length || !REPORT_TITLE.test(lines[start]!)) return text.trim();
  while (start < lines.length && (!lines[start]!.trim() || REPORT_TITLE.test(lines[start]!) || HEADER_FIELD.test(lines[start]!))) start += 1;
  return lines.slice(start).join("\n").trim();
}

/** The text shown as the conclusion: structured conclusion, else a legacy full report, else the stored headline. */
export function getInvestigationConclusion(
  investigation: SreIncidentDetail["latestInvestigation"] | undefined,
  rootCauseSummary: string | null,
) {
  const structured = investigation?.structured ?? null;
  // Runs without structured output keep their full report, which is longer than the stored headline.
  const fullReport = !structured && investigation?.status === "completed" ? investigation.summary : null;
  const raw = structured?.conclusion ?? fullReport ?? rootCauseSummary;
  // Runs stored before ids were stripped at parse time still carry inline id lists.
  const stripped = raw ? stripEvidenceIdLists(raw) : raw;
  return stripped ? stripReportBoilerplate(stripped) || stripped : stripped;
}

export function IncidentAiSummaryCard({
  rootCauseSummary,
  confidenceScore,
  investigationStatus,
  investigation = null,
  feedback,
  onOpenInvestigation,
  runControls,
  source = "investigation",
}: IncidentAiSummaryCardProps) {
  const running = investigationStatus === "running";
  const failed = investigationStatus === "failed" || investigationStatus === "aborted" || investigationStatus === "timed_out";
  const structured = investigation?.structured ?? null;
  // The card shows one paragraph; the full report is on the Investigation tab.
  const headline = reportHeadline(getInvestigationConclusion(investigation, rootCauseSummary));
  const inconclusive = structured ? structured.outcome === "inconclusive" : false;
  const confidence = confidenceLabel(rootCauseSummary ? confidenceScore : null);
  // Runs before structured output stored no score; show no rating rather than a misleading one.
  const unrated = Boolean(rootCauseSummary) && confidenceScore === null && !structured;
  const rated = source === "investigation" && investigationStatus === "completed" && !unrated;
  const stepCount = investigation?.steps.length ?? 0;
  const nextCheck = structured?.nextChecks[0] ?? null;

  return (
    <Card data-testid="incident-ai-summary" className="shrink-0 gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4 py-0">
        <CardTitle id="incident-ai-summary-title" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Summary
        </CardTitle>
        {headline && !running && source !== "investigation" && (
          <span className="text-xs text-muted-foreground">{SOURCE_LABEL[source]}</span>
        )}
        {headline && rated && (
          inconclusive || confidence.label === "Inconclusive" ? (
            <TableBadge tone="slate" compact aria-label="Confidence: Inconclusive">
              Inconclusive
            </TableBadge>
          ) : (
            <TableBadge tone={confidence.tone} compact aria-label={`Confidence: ${confidence.label}`}>
              Confidence: {confidence.label}
            </TableBadge>
          )
        )}
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-0">
        {running && (
          <p role="status" className="text-sm text-muted-foreground">
            {stepCount > 0
              ? `Working: ${stepCount} ${stepCount === 1 ? "check" : "checks"} done so far.`
              : "Waiting for the first findings."}
          </p>
        )}
        {failed && (
          <Alert variant="destructive">
            <AlertTitle>Investigation did not complete</AlertTitle>
            <AlertDescription className="line-clamp-3">
              {investigation?.summary || "No completed report is available. Review the saved evidence before trying again."}
            </AlertDescription>
          </Alert>
        )}
        {headline ? (
          <div className="space-y-1.5">
            {inconclusive && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                No root cause established
              </p>
            )}
            {(failed || running) && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous conclusion</p>
            )}
            <p data-testid="ai-summary-body" className="break-words text-sm leading-relaxed">
              {headline}
            </p>
            {structured?.downgraded && (
              <p className="text-xs text-muted-foreground">
                The model suggested a cause, but the cited evidence did not support it, so this is reported as inconclusive.
              </p>
            )}
          </div>
        ) : (
          !running && !failed && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">No AI analysis yet.</p>
              {runControls}
            </div>
          )
        )}
        {nextCheck && !running && (
          <p className="line-clamp-2 break-words text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Next step: </span>
            {nextCheck}
          </p>
        )}
        {(headline || running || failed) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            {onOpenInvestigation && (
              <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 text-muted-foreground" onClick={onOpenInvestigation}>
                View investigation
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {feedback}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { FileSearch, PanelRightOpen, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

type IncidentAiSummaryCardProps = {
  rootCauseSummary: string | null;
  /** Decimal string from the database (0-1). */
  confidenceScore: string | null;
  investigationStatus: "running" | "completed" | "failed" | "aborted" | "timed_out" | null;
  /** Latest investigation run; enables citations, live progress and failure details. */
  investigation?: SreIncidentDetail["latestInvestigation"];
  evidence?: SreIncidentDetail["evidence"];
  /** Whole-investigation feedback control, shown at the right of the footer. */
  feedback?: React.ReactNode;
  /** Opens the investigation details sheet. */
  onOpenDetails?: () => void;
  /** Shows a compact "Investigate" action in the empty state. */
  canInvestigate?: boolean;
};

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

export function IncidentAiSummaryCard({
  rootCauseSummary,
  confidenceScore,
  investigationStatus,
  investigation = null,
  evidence = [],
  feedback,
  onOpenDetails,
  canInvestigate = false,
}: IncidentAiSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const running = investigationStatus === "running";
  const failed = investigationStatus === "failed" || investigationStatus === "aborted" || investigationStatus === "timed_out";
  const structured = investigation?.structured ?? null;
  // Runs without structured output keep their full report, which is longer than the stored headline.
  const fullReport = !structured && investigationStatus === "completed" ? investigation?.summary : null;
  const rawConclusion = structured?.conclusion ?? fullReport ?? rootCauseSummary;
  // Runs stored before ids were stripped at parse time still carry inline id lists.
  const stripped = rawConclusion ? stripEvidenceIdLists(rawConclusion) : rawConclusion;
  const conclusion = stripped ? stripReportBoilerplate(stripped) || stripped : stripped;
  const inconclusive = structured ? structured.outcome === "inconclusive" : false;
  const confidence = confidenceLabel(rootCauseSummary ? confidenceScore : null);
  // Runs before structured output stored no score; show no rating rather than a misleading one.
  const unrated = Boolean(rootCauseSummary) && confidenceScore === null && !structured;
  const citations = (structured?.topEvidenceIds ?? [])
    .map((id) => evidence.find((item) => item.id === id))
    .filter((item): item is SreIncidentDetail["evidence"][number] => Boolean(item))
    .slice(0, 3);
  const stepCount = investigation?.steps.length ?? 0;
  const summaryOnly = investigationStatus === "completed" && Boolean(investigation) && !structured;
  const nextCheck = structured?.nextChecks[0] ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [clampable, setClampable] = useState(false);
  // New content (the detail query polls) starts collapsed again.
  const [shownConclusion, setShownConclusion] = useState(conclusion);
  if (shownConclusion !== conclusion) {
    setShownConclusion(conclusion);
    setExpanded(false);
  }
  // Offer "Show more" only when the collapsed body actually hides content, re-checked when the card resizes.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    const measure = () => setClampable(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [conclusion, expanded]);

  return (
    <Card data-testid="incident-ai-summary" className="shrink-0 gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4 py-0">
        <CardTitle id="incident-ai-summary-title" className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          AI summary
        </CardTitle>
        {conclusion && !running && !unrated && (
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
        {conclusion ? (
          <div className="space-y-1.5">
            {inconclusive && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                No root cause established
              </p>
            )}
            {(failed || running) && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous conclusion</p>
            )}
            {/* Collapsed height clamps block markdown too (line-clamp only clamps plain text); expanding grows the page, no inner scroller. */}
            <div
              ref={bodyRef}
              data-testid="ai-summary-body"
              className={cn(
                "break-words text-sm leading-relaxed",
                !expanded && "max-h-28 overflow-hidden",
                clampable && !expanded && "relative after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-t after:from-card after:to-transparent",
              )}
            >
              <SreMessageContent content={conclusion} />
            </div>
            {clampable && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="rounded-sm text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
            {structured?.downgraded && (
              <p className="text-xs text-muted-foreground">
                The model suggested a cause, but the cited evidence did not support it, so this is reported as inconclusive.
              </p>
            )}
          </div>
        ) : (
          !running && !failed && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">No AI analysis yet.</p>
              {onOpenDetails && (
                <Button
                  type="button"
                  variant={canInvestigate ? "outline" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={onOpenDetails}
                >
                  {canInvestigate ? <Sparkles className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  {canInvestigate ? "Investigate" : "Investigation details"}
                </Button>
              )}
            </div>
          )
        )}
        {citations.length > 0 && !running && (
          <div className="flex flex-wrap items-center gap-2" aria-label={inconclusive ? "Reviewed evidence" : "Cited evidence"}>
            {citations.map((item) => (
              <EvidenceDetailsDialog key={item.id} item={item}>
                <button
                  type="button"
                  aria-label={`View evidence: ${item.title}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[16rem]"
                >
                  <FileSearch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{item.title}</span>
                </button>
              </EvidenceDetailsDialog>
            ))}
          </div>
        )}
        {nextCheck && !running && (
          <p className="line-clamp-2 break-words text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Next step: </span>
            {nextCheck}
          </p>
        )}
        {summaryOnly && (
          <p className="text-xs text-muted-foreground">
            Summary only: this run did not return structured hypotheses. Run it again for a ranked breakdown.
          </p>
        )}
        {(conclusion || running || failed) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          {onOpenDetails && (
            <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 text-muted-foreground" onClick={onOpenDetails}>
              <PanelRightOpen className="h-4 w-4" />
              Investigation details
            </Button>
          )}
          {feedback}
        </div>
        )}
      </CardContent>
    </Card>
  );
}

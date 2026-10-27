"use client";

import { useState } from "react";
import { FileSearch, PanelRightOpen, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

type IncidentAiSummaryCardProps = {
  rootCauseSummary: string | null;
  /** Decimal string from the database (0-1). */
  confidenceScore: string | null;
  investigationStatus: "running" | "completed" | "failed" | "aborted" | "timed_out" | null;
  /** Latest investigation run; enables citations, live progress and failure details. */
  investigation?: SreIncidentDetail["latestInvestigation"];
  evidence?: SreIncidentDetail["evidence"];
  /** Whole-investigation feedback control, shown beside "Was this right?". */
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

const CLAMP_THRESHOLD = 240;

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
  const conclusion = rawConclusion ? stripEvidenceIdLists(rawConclusion) : rawConclusion;
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
  const clampable = (conclusion?.length ?? 0) > CLAMP_THRESHOLD;

  return (
    <Card data-testid="incident-ai-summary" className="shrink-0 gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-4 py-0">
        <CardTitle id="incident-ai-summary-title" className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          AI summary
          <InfoTip label="About the AI summary">
            The AI&apos;s best explanation from the evidence it could read. Inconclusive means it did not find enough proof.
          </InfoTip>
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
      <CardContent className="space-y-3 px-4">
        {running && (
          <p role="status" className="text-sm text-muted-foreground">
            {stepCount > 0
              ? `Working: ${stepCount} ${stepCount === 1 ? "check" : "checks"} done so far.`
              : "Waiting for the first findings."}
          </p>
        )}
        {failed && (
          <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            <p className="font-medium">Investigation did not complete</p>
            <p className="mt-1 line-clamp-3">
              {investigation?.summary || "No completed report is available. Review the saved evidence before trying again."}
            </p>
          </div>
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
            <div className={expanded ? "max-h-48 overflow-y-auto" : clampable ? "line-clamp-3" : undefined}>
              {structured ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{conclusion}</p>
              ) : (
                <div className="break-words text-sm leading-relaxed">
                  <SreMessageContent content={conclusion} />
                </div>
              )}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">{feedback}</div>
          {onOpenDetails && (
            <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails}>
              <PanelRightOpen className="h-4 w-4" />
              Investigation details
            </Button>
          )}
        </div>
        )}
      </CardContent>
    </Card>
  );
}

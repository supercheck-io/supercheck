import Link from "next/link";
import { FileSearch, Network, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type IncidentAiSummaryCardProps = {
  rootCauseSummary: string | null;
  /** Decimal string from the database (0-1). */
  confidenceScore: string | null;
  investigationStatus: "running" | "completed" | "failed" | "aborted" | "timed_out" | null;
  /** Latest investigation run; enables citations, live progress and failure details. */
  investigation?: SreIncidentDetail["latestInvestigation"];
  evidence?: SreIncidentDetail["evidence"];
  /** Enables the link to the investigation map. */
  incidentId?: string;
  children?: React.ReactNode;
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

export function IncidentAiSummaryCard({
  rootCauseSummary,
  confidenceScore,
  investigationStatus,
  investigation = null,
  evidence = [],
  incidentId,
  children,
}: IncidentAiSummaryCardProps) {
  const running = investigationStatus === "running";
  const failed = investigationStatus === "failed" || investigationStatus === "aborted" || investigationStatus === "timed_out";
  const structured = investigation?.structured ?? null;
  // Runs without structured output keep their full report, which is longer than the stored headline.
  const fullReport = !structured && investigationStatus === "completed" ? investigation?.summary : null;
  const conclusion = structured?.conclusion ?? fullReport ?? rootCauseSummary;
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

  return (
    <Card data-testid="incident-ai-summary">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle id="incident-ai-summary-title" className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            AI summary
          </CardTitle>
          <CardDescription>
            {running
              ? "Investigating now. This updates when the run finishes."
              : "Latest conclusion from the AI investigation. Check the cited evidence before acting."}
          </CardDescription>
        </div>
        {conclusion && !running && !unrated && (
          inconclusive || confidence.label === "Inconclusive" ? (
            <TableBadge tone="slate" compact aria-label="Confidence: Inconclusive">
              Inconclusive
            </TableBadge>
          ) : (
            <TableBadge tone={confidence.tone} compact aria-label={`Confidence: ${confidence.label}`}>
              {confidence.label} confidence
            </TableBadge>
          )
        )}
      </CardHeader>
      <CardContent className="space-y-4">
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
            <p className="mt-1">
              {investigation?.summary || "No completed report is available. Review the saved evidence before trying again."}
            </p>
          </div>
        )}
        {conclusion ? (
          <div className="space-y-2">
            {inconclusive && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                No root cause established
              </p>
            )}
            {(failed || running) && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous conclusion</p>
            )}
            {structured ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{conclusion}</p>
            ) : (
              <div className="break-words text-sm leading-relaxed">
                <SreMessageContent content={conclusion} />
              </div>
            )}
            {structured?.downgraded && (
              <p className="text-xs text-muted-foreground">
                The model suggested a cause, but the cited evidence did not support it, so this is reported as inconclusive.
              </p>
            )}
          </div>
        ) : (
          !running && !failed && (
            <p className="text-sm text-muted-foreground">
              No AI conclusion yet. Use Investigate to start one; an inconclusive result is reported as such, never guessed.
            </p>
          )
        )}
        {structured && structured.nextChecks.length > 0 && !running && (
          <section aria-labelledby="investigation-next-checks" className="space-y-1.5">
            <h3 id="investigation-next-checks" className="text-sm font-medium">
              Next safe checks
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {structured.nextChecks.map((check) => (
                <li key={check} className="break-words">
                  {check}
                </li>
              ))}
            </ul>
          </section>
        )}
        {summaryOnly && (
          <p className="text-xs text-muted-foreground">
            Summary only: this run did not return structured hypotheses. Run it again for a ranked breakdown.
          </p>
        )}
        {(citations.length > 0 || (incidentId && evidence.length > 0)) && !running && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Cited evidence">
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
            {incidentId && (
              <Link
                href={`/copilot/evidence-graph?incident=${incidentId}`}
                className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Network className="h-3.5 w-3.5" aria-hidden="true" />
                Investigation Map
              </Link>
            )}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

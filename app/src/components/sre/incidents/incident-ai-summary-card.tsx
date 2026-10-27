import { Sparkles } from "lucide-react";

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

/** Boundary for the AI conclusion; a richer card (citations, hypotheses, feedback) replaces the body later. */
export function IncidentAiSummaryCard({
  rootCauseSummary,
  confidenceScore,
  investigationStatus,
  children,
}: IncidentAiSummaryCardProps) {
  const running = investigationStatus === "running";
  const confidence = confidenceLabel(rootCauseSummary ? confidenceScore : null);

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
              : "Latest conclusion from the AI investigation."}
          </CardDescription>
        </div>
        {rootCauseSummary && !running && (
          <TableBadge tone={confidence.tone} compact aria-label={`Confidence: ${confidence.label}`}>
            {confidence.label} confidence
          </TableBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {rootCauseSummary ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {rootCauseSummary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {running
              ? "Waiting for the first findings."
              : "No AI conclusion yet. Use Investigate to start one; an inconclusive result is reported as such, never guessed."}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

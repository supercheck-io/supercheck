"use client";

import { Activity, Bot, CheckCircle2, FileText, GitBranch, ShieldCheck } from "lucide-react";

import { extractSreEvidenceCitations, type SreEvidenceCitationReference } from "@/components/sre/chat-message-list";
import { type SreInvestigationProgressEvent } from "@/components/sre/investigation-progress-card";
import { extractSreVerificationTasks } from "@/components/sre/verification-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SreInvestigationReportPanelProps = {
  evidenceReferences: SreEvidenceCitationReference[];
  latestAssistantContent?: string | null;
  progressEvents: SreInvestigationProgressEvent[];
  isInvestigating?: boolean;
};

type ReportStatus = {
  label: string;
  description: string;
  tone: "waiting" | "draft" | "backed";
};

const REPORT_LINE_SKIP_PATTERN = /^(verification|next steps?|action items?|evidence|cited evidence|citations?)\b/i;

function truncate(value: string, maxLength = 220) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function normalizeReportLine(value: string) {
  return value
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

function getWorkingTheory(content?: string | null) {
  if (!content) {
    return null;
  }

  const lines = content
    .replace(/\\n/g, "\n")
    .split("\n")
    .map(normalizeReportLine)
    .filter((line) => line.length >= 10 && !REPORT_LINE_SKIP_PATTERN.test(line));

  return lines[0] ? truncate(lines[0]) : null;
}

function getReportStatus({ hasContent, matchedCitationCount, isInvestigating }: {
  hasContent: boolean;
  matchedCitationCount: number;
  isInvestigating: boolean;
}): ReportStatus {
  if (isInvestigating) {
    return {
      label: "Building",
      description: "Streaming read-only investigation steps into a draft responder report.",
      tone: "draft",
    };
  }

  if (!hasContent) {
    return {
      label: "Waiting",
      description: "Ask SRE AI to generate an incident analysis before using this report.",
      tone: "waiting",
    };
  }

  if (matchedCitationCount > 0) {
    return {
      label: "Evidence-backed draft",
      description: `${matchedCitationCount} cited evidence item${matchedCitationCount === 1 ? "" : "s"} matched stored incident evidence.`,
      tone: "backed",
    };
  }

  return {
    label: "Uncited draft",
    description: "Assistant content is available, but no stored evidence citation has been matched yet.",
    tone: "draft",
  };
}

function StatusDot({ tone }: { tone: ReportStatus["tone"] }) {
  return (
    <span
      className={cn(
        "h-2.5 w-2.5 rounded-full",
        tone === "backed" && "bg-emerald-500",
        tone === "draft" && "bg-amber-500",
        tone === "waiting" && "bg-muted-foreground"
      )}
      aria-hidden="true"
    />
  );
}

export function SreInvestigationReportPanel({
  evidenceReferences,
  latestAssistantContent,
  progressEvents,
  isInvestigating = false,
}: SreInvestigationReportPanelProps) {
  const citations = extractSreEvidenceCitations(latestAssistantContent ?? "");
  const evidenceById = new Map(evidenceReferences.map((evidence) => [evidence.id, evidence]));
  const matchedEvidence = citations.flatMap((citation) => {
    const evidence = evidenceById.get(citation);
    return evidence ? [{ citation, evidence }] : [];
  });
  const unmatchedCitations = citations.filter((citation) => !evidenceById.has(citation));
  const verificationTasks = extractSreVerificationTasks(latestAssistantContent);
  const latestEvents = progressEvents.slice(-4);
  const workingTheory = getWorkingTheory(latestAssistantContent);
  const status = getReportStatus({
    hasContent: Boolean(latestAssistantContent?.trim()),
    matchedCitationCount: matchedEvidence.length,
    isInvestigating,
  });

  return (
    <Card className="overflow-hidden border bg-gradient-to-br from-background via-background to-muted/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Investigation report
            </CardTitle>
            <CardDescription>Live responder brief generated from the latest SRE AI answer and stored evidence citations.</CardDescription>
          </div>
          <Badge variant={status.tone === "backed" ? "secondary" : "outline"} className="gap-2">
            <StatusDot tone={status.tone} />
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-labelledby="sre-report-theory-heading" className="rounded-xl border bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <h4 id="sre-report-theory-heading" className="text-sm font-medium">
              Working theory
            </h4>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {workingTheory ?? "No working theory yet. Ask SRE AI for a root-cause hypothesis after evidence has been collected."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{status.description}</p>
        </section>

        <section aria-labelledby="sre-report-graph-heading" className="rounded-xl border bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h4 id="sre-report-graph-heading" className="text-sm font-medium">
              Evidence graph
            </h4>
          </div>
          {matchedEvidence.length > 0 || unmatchedCitations.length > 0 ? (
            <div className="mt-3 space-y-2">
              {matchedEvidence.map(({ citation, evidence }) => (
                <a
                  key={citation}
                  href={`#sre-evidence-${citation}`}
                  aria-label={`Open ${evidence.title} evidence ${citation}`}
                  className="block rounded-lg border bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      {citation}
                    </Badge>
                    <span className="font-medium">{evidence.title}</span>
                    <Badge variant="outline">{evidence.evidenceType}</Badge>
                  </span>
                </a>
              ))}
              {unmatchedCitations.length > 0 && (
                <div className="rounded-lg border border-dashed bg-muted/10 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">Cited but not found in stored evidence</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unmatchedCitations.map((citation) => (
                      <Badge key={citation} variant="outline" className="font-mono text-[11px]">
                        {citation}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No evidence links yet. Ask SRE AI to cite incident evidence IDs or run read-only connector collection.
            </p>
          )}
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-labelledby="sre-report-actions-heading" className="rounded-xl border bg-background/70 p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <h4 id="sre-report-actions-heading" className="text-sm font-medium">
                Human verification
              </h4>
            </div>
            {verificationTasks.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {verificationTasks.slice(0, 3).map((task, index) => (
                  <li key={`${index}-${task.slice(0, 32)}`} className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Action {index + 1}:</span> {task}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No verification actions extracted yet. SuperCheck stays read-only and does not apply remediation automatically.
              </p>
            )}
          </section>

          <section aria-labelledby="sre-report-timeline-heading" className="rounded-xl border bg-background/70 p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h4 id="sre-report-timeline-heading" className="text-sm font-medium">
                Latest activity
              </h4>
            </div>
            {latestEvents.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {latestEvents.map((event) => (
                  <li key={event.id} className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                    <CheckCircle2 className={cn("mt-0.5 h-3.5 w-3.5", event.status === "success" ? "text-emerald-600" : "text-muted-foreground")} />
                    <span>
                      <span className="font-medium text-foreground">{event.title}</span>
                      {event.description && <span className="text-muted-foreground"> · {event.description}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No streamed investigation activity for this conversation yet.</p>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

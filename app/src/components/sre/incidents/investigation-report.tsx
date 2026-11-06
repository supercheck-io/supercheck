"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { GenerateEvidenceBriefButton } from "@/components/sre/incidents/generate-evidence-brief-button";
import { formatAgo } from "@/components/sre/incidents/incident-age";
import { confidenceLabel, getInvestigationConclusion } from "@/components/sre/incidents/incident-ai-summary-card";
import { InvestigationHypotheses } from "@/components/sre/incidents/investigation-hypotheses";
import { InvestigationStepTrace } from "@/components/sre/incidents/investigation-step-trace";
import { SimilarIncidentsList, useSimilarIncidentCount } from "@/components/sre/incidents/similar-incidents-card";
import { SreIncidentBriefReportActions } from "@/components/sre/incidents/sre-incident-brief-report";
import { SreInvestigationPanel, SreReportSnapshotMenuItem } from "@/components/sre/incidents/sre-investigation-panel";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableBadge } from "@/components/ui/table-badge";

/** Where the Investigation tab scrolls to when it opens. `n` makes a repeated request fire again. */
export type ReportFocus = { target: string; n: number };

const SECTION_ID = "sre-report-";

function Section({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`${SECTION_ID}${id}`} aria-labelledby={`${SECTION_ID}${id}-title`} className="scroll-mt-4 space-y-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h3 id={`${SECTION_ID}${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  metric: "Metric",
  log: "Log",
  trace: "Trace",
  artifact: "Artifact",
  deployment: "Deployment",
  event: "Event",
  document: "Document",
  topology: "Topology",
};

function formatTime(value: Date | string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function EvidenceList({ evidence }: { evidence: SreIncidentDetail["evidence"] }) {
  if (evidence.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence gathered yet.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {evidence.map((item) => (
        <li key={item.id} id={`sre-evidence-${item.id}`} className="scroll-mt-4">
          <EvidenceDetailsDialog item={item}>
            <button
              type="button"
              aria-label={`View evidence: ${item.title}`}
              className="flex w-full min-w-0 flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
                {[EVIDENCE_TYPE_LABEL[item.evidenceType] ?? item.evidenceType, formatTime(item.observedAt)].filter(Boolean).join(" · ")}
              </span>
            </button>
          </EvidenceDetailsDialog>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Investigation tab: one report. Conclusion first (the AI investigation, or the evidence brief until
 * one has run), then hypotheses, evidence and the step trace. Similar incidents appear only when there are any.
 */
export function InvestigationReport({
  detail,
  focus,
  serviceMappingHref,
}: {
  detail: SreIncidentDetail;
  focus: ReportFocus | null;
  serviceMappingHref: string;
}) {
  const { incident, permissions, latestInvestigation: investigation } = detail;
  const similarCount = useSimilarIncidentCount(incident.id);

  const savedSummary =
    typeof detail.latestBrief?.agentStateSnapshot?.summary === "string" ? detail.latestBrief.agentStateSnapshot.summary : "";
  const savedProvider = detail.latestBrief?.agentStateSnapshot?.provider;
  const [briefSummary, setBriefSummary] = useState(savedSummary);
  const [briefIsAi, setBriefIsAi] = useState<boolean | null>(
    savedProvider === "ai" ? true : savedProvider === "fallback" ? false : null,
  );
  const [streaming, setStreaming] = useState(false);
  // A failed regeneration puts the saved brief back instead of leaving the section blank or half-written.
  const restoreSavedBrief = () => {
    setBriefSummary(savedSummary);
    setBriefIsAi(savedProvider === "ai" ? true : savedProvider === "fallback" ? false : null);
    setStreaming(false);
  };

  useEffect(() => {
    if (!focus) return;
    const target = focus.target.startsWith("sre-evidence-") ? focus.target : `${SECTION_ID}${focus.target}`;
    document.getElementById(target)?.scrollIntoView?.({ block: "start" });
  }, [focus]);

  const running = investigation?.status === "running";
  const failed = investigation?.status === "failed" || investigation?.status === "aborted" || investigation?.status === "timed_out";
  const structured = investigation?.structured ?? null;
  // Before any investigation the stored root cause is the brief's headline, so the brief itself is shown instead.
  const investigationConclusion = getInvestigationConclusion(
    investigation,
    investigation ? incident.rootCauseSummary : (detail.triageSummary ?? null),
  );
  // The brief stands in only until an investigation has produced something to read.
  const useBrief = !investigationConclusion && (Boolean(briefSummary) || streaming);
  const inconclusive = structured ? structured.outcome === "inconclusive" : false;
  const confidence = confidenceLabel(structured ? String(structured.confidence) : incident.confidenceScore);
  // Runs before structured output stored no score; show no rating rather than a misleading one.
  const unrated = !structured && incident.confidenceScore === null;
  // Only an investigation is rated; a brief or triage summary is not.
  const showConfidence = Boolean(investigation) && Boolean(investigationConclusion) && !unrated && !running;
  const nextChecks = structured?.nextChecks ?? [];
  const staleBrief = detail.latestBrief?.agentStateSnapshot?.evidenceCount;
  const briefOutdated = typeof staleBrief === "number" && staleBrief < detail.evidence.length;

  // The brief is the quick look before an investigation; once one has run, the investigation is the report.
  const briefButton = permissions.canInvestigate && !investigation ? (
    <GenerateEvidenceBriefButton
      incidentId={incident.id}
      hasBrief={Boolean(detail.latestBrief) || Boolean(briefSummary)}
      variant="outline"
      // Streams into the conclusion only while the brief is what the conclusion shows.
      {...(!investigationConclusion
        ? {
            onStreamStart: () => {
              setBriefSummary("");
              setBriefIsAi(null);
              setStreaming(true);
            },
            onStreamContent: (chunk: string) => setBriefSummary((current) => current + chunk),
            onStreamDone: (result: { brief?: { summary: string; provider: "ai" | "fallback" } }) => {
              if (result.brief) {
                setBriefSummary(result.brief.summary);
                setBriefIsAi(result.brief.provider === "ai");
              }
              setStreaming(false);
            },
            onStreamError: restoreSavedBrief,
          }
        : {})}
    />
  ) : null;

  const lastRun = investigation
    ? running
      ? "Investigation in progress"
      : `Last run ${investigation.status === "completed" ? "completed" : "ended"} ${formatAgo(investigation.completedAt ?? investigation.createdAt)}`
    : "No investigation has run yet";
  const snapshotSaved = detail.latestReportSnapshot && investigation && detail.latestReportSnapshot.investigationRunId === investigation.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 pt-1 text-sm text-muted-foreground">
          {lastRun}
          {snapshotSaved && " · Snapshot saved"}
        </p>
        {permissions.canInvestigate && (
          <SreInvestigationPanel
            key={investigation?.id ?? "no-investigation"}
            incidentId={incident.id}
            hasPrimaryService={Boolean(incident.primaryServiceId)}
            serviceMappingHref={serviceMappingHref}
            canMapService={permissions.canUpdate}
            latestInvestigation={investigation}
            canInvestigate={permissions.canInvestigate}
            canUseLiveConnectors={permissions.canUseLiveConnectors}
            investigationEnabled={detail.capabilities.investigationEnabled}
          >
            {investigation?.status === "completed" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" aria-label="More investigation actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <SreReportSnapshotMenuItem incidentId={incident.id} latestInvestigation={investigation} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SreInvestigationPanel>
        )}
      </div>

      <Section
        id="conclusion"
        title="Conclusion"
        action={
          showConfidence &&
          (inconclusive || confidence.label === "Inconclusive" ? (
            <TableBadge tone="slate" compact aria-label="Confidence: Inconclusive">
              Inconclusive
            </TableBadge>
          ) : (
            <TableBadge tone={confidence.tone} compact aria-label={`Confidence: ${confidence.label}`}>
              Confidence: {confidence.label}
            </TableBadge>
          ))
        }
      >
        {failed && (
          <Alert variant="destructive">
            <AlertTitle>Investigation did not complete</AlertTitle>
            <AlertDescription className="line-clamp-3">
              {investigation?.summary || "No completed report is available. Review the saved evidence before trying again."}
            </AlertDescription>
          </Alert>
        )}
        {investigationConclusion ? (
          <div className="space-y-3">
            {(failed || running) && <p className="text-xs text-muted-foreground">Previous conclusion</p>}
            {inconclusive && <p className="text-xs text-muted-foreground">No root cause established.</p>}
            <div className="break-words text-sm leading-relaxed">
              <SreMessageContent content={investigationConclusion} />
            </div>
            {structured?.downgraded && (
              <p className="text-xs text-muted-foreground">
                The model suggested a cause, but the cited evidence did not support it, so this is reported as inconclusive.
              </p>
            )}
            {nextChecks.length > 0 && !running && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Recommended next steps</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  {nextChecks.map((step, index) => (
                    <li key={index} className="break-words">
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : useBrief ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {streaming
                  ? "Generating the evidence brief..."
                  : briefIsAi === false
                    ? "Basic summary of the saved evidence (AI unavailable). Run an investigation for a full analysis."
                    : "Summary of the saved evidence. Run an investigation for a full analysis."}
              </p>
              {briefSummary && (
                <SreIncidentBriefReportActions
                  incidentNumber={incident.incidentNumber}
                  incidentTitle={incident.title}
                  content={briefSummary}
                  disabled={streaming}
                />
              )}
            </div>
            <div aria-busy={streaming} className="break-words text-sm leading-relaxed">
              <SreMessageContent content={briefSummary} />
            </div>
            {briefOutdated && !streaming && (
              <p className="text-xs text-muted-foreground">Newer evidence has been collected since this brief. Regenerate it to include that.</p>
            )}
            {!streaming && briefButton}
          </div>
        ) : (
          !running && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {permissions.canInvestigate
                  ? "No conclusion yet. Run an investigation, or generate a brief from the saved evidence."
                  : "No conclusion yet."}
              </p>
              {briefButton}
            </div>
          )
        )}
      </Section>

      {investigation && (
        <InvestigationHypotheses
          incidentId={incident.id}
          investigation={investigation}
          evidence={detail.evidence}
          canGiveFeedback={permissions.canUpdate}
        />
      )}

      <Section
        id="evidence"
        title={detail.evidence.length > 0 ? `Evidence (${detail.evidence.length})` : "Evidence"}
      >
        <EvidenceList evidence={detail.evidence} />
      </Section>

      {investigation && (
        <InvestigationStepTrace key={investigation.id} steps={investigation.steps} running={running} />
      )}

      {Boolean(similarCount) && (
        <Section id="similar" title={`Similar incidents (${similarCount})`}>
          <SimilarIncidentsList incidentId={incident.id} />
        </Section>
      )}
    </div>
  );
}

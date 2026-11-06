"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CircleAlert,
  ArrowRight,
  Bell,
  CircleCheck,
  Clock,
  Database,
  FileText,
  GitCommitHorizontal,
  MoreHorizontal,
  Network,
  Paperclip,
  ScrollText,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { GenerateEvidenceBriefButton } from "@/components/sre/incidents/generate-evidence-brief-button";
import { formatAgo } from "@/components/sre/incidents/incident-age";
import { confidenceLabel, getInvestigationConclusion } from "@/components/sre/incidents/incident-ai-summary-card";
import { IconTile, SectionTitle, type IconTone } from "@/components/sre/incidents/incident-ui";
import { InvestigationHypotheses } from "@/components/sre/incidents/investigation-hypotheses";
import { InvestigationStepTrace } from "@/components/sre/incidents/investigation-step-trace";
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

function Section({
  id,
  title,
  icon,
  tone,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: IconTone;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={`${SECTION_ID}${id}`} aria-labelledby={`${SECTION_ID}${id}-title`} className="scroll-mt-4 space-y-3">
      <SectionTitle id={`${SECTION_ID}${id}-title`} icon={icon} tone={tone} count={count} action={action}>
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}

const EVIDENCE_TYPE: Record<string, { label: string; icon: LucideIcon; tone: IconTone }> = {
  metric: { label: "Metric", icon: Activity, tone: "blue" },
  log: { label: "Log", icon: ScrollText, tone: "slate" },
  trace: { label: "Trace", icon: Waypoints, tone: "indigo" },
  artifact: { label: "Artifact", icon: Paperclip, tone: "slate" },
  deployment: { label: "Deployment", icon: GitCommitHorizontal, tone: "violet" },
  event: { label: "Event", icon: Bell, tone: "amber" },
  document: { label: "Document", icon: FileText, tone: "sky" },
  topology: { label: "Topology", icon: Network, tone: "emerald" },
};
const OTHER_EVIDENCE = { label: "Evidence", icon: Database, tone: "slate" } as const;

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
      {evidence.map((item) => {
        const type = EVIDENCE_TYPE[item.evidenceType] ?? OTHER_EVIDENCE;
        return (
          <li key={item.id} id={`sre-evidence-${item.id}`} className="scroll-mt-4">
            <EvidenceDetailsDialog item={item}>
              <button
                type="button"
                aria-label={`View evidence: ${item.title}`}
                className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <IconTile icon={type.icon} tone={type.tone} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{type.label}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>
                  {formatTime(item.observedAt)}
                </span>
              </button>
            </EvidenceDetailsDialog>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Investigation tab: one report. Conclusion first (the AI investigation, or the evidence brief until
 * one has run), then hypotheses, evidence and the step trace. Similar incidents are in the page's right-hand column.
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
  // Before any investigation the stored root cause is only the brief's headline, so the brief itself is shown.
  const investigationConclusion = getInvestigationConclusion(investigation, investigation ? incident.rootCauseSummary : null);
  // The brief stands in only until an investigation has produced something to read.
  const useBrief = !investigationConclusion && (Boolean(briefSummary) || streaming);
  // With neither, the triage finding is the conclusion (same order as the Overview summary card).
  const triageConclusion =
    !investigation && !useBrief ? getInvestigationConclusion(null, detail.triageSummary ?? null) : null;
  const conclusion = investigationConclusion ?? triageConclusion;
  const inconclusive = structured ? structured.outcome === "inconclusive" : false;
  const confidence = confidenceLabel(structured ? String(structured.confidence) : incident.confidenceScore);
  // Runs before structured output stored no score; show no rating rather than a misleading one.
  const unrated = !structured && incident.confidenceScore === null;
  // Only a completed investigation is rated; a brief, a triage summary or a failed run's earlier text is not.
  const showConfidence = investigation?.status === "completed" && Boolean(investigationConclusion) && !unrated;
  const nextChecks = structured?.nextChecks ?? [];
  const staleBrief = detail.latestBrief?.agentStateSnapshot?.evidenceCount;
  const briefOutdated = typeof staleBrief === "number" && staleBrief < detail.evidence.length;

  // The brief is the quick look before an investigation completes; after that the investigation is the report
  // (the server also stops a brief from replacing a completed investigation's result).
  const briefButton = permissions.canInvestigate && investigation?.status !== "completed" ? (
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
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            {lastRun}
          </span>
          {snapshotSaved && (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              Snapshot saved
            </span>
          )}
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
        icon={Sparkles}
        tone="violet"
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
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Last investigation failed</AlertTitle>
            <AlertDescription className="line-clamp-2">
              {investigation?.summary || "No completed report is available. Review the saved evidence before trying again."}
            </AlertDescription>
          </Alert>
        )}
        {conclusion ? (
          <div className="space-y-3">
            {triageConclusion && <p className="text-xs text-muted-foreground">From AI triage. Run an investigation for a full analysis.</p>}
            {(failed || running) && <p className="text-xs text-muted-foreground">Previous conclusion</p>}
            {inconclusive && <p className="text-xs text-muted-foreground">No root cause established.</p>}
            <div className="break-words rounded-lg border-l-2 border-violet-500/60 bg-muted/30 px-4 py-3 text-sm leading-relaxed">
              <SreMessageContent content={conclusion} />
            </div>
            {structured?.downgraded && (
              <p className="text-xs text-muted-foreground">
                The model suggested a cause, but the cited evidence did not support it, so this is reported as inconclusive.
              </p>
            )}
            {nextChecks.length > 0 && !running && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next steps</p>
                <ul className="space-y-1.5 text-sm">
                  {nextChecks.map((step, index) => (
                    <li key={index} className="flex gap-2 break-words">
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-violet-500" aria-hidden="true" />
                      <span className="min-w-0">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!streaming && briefButton}
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

      <Section id="evidence" title="Evidence" icon={Database} tone="blue" count={detail.evidence.length || undefined}>
        <EvidenceList evidence={detail.evidence} />
      </Section>

      {investigation && (
        <InvestigationStepTrace key={investigation.id} steps={investigation.steps} running={running} />
      )}

    </div>
  );
}

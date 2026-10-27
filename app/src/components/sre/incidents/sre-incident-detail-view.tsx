"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, FileText, MoreHorizontal } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { AcknowledgeSreIncidentButton } from "@/components/sre/incidents/acknowledge-sre-incident-button";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { IncidentAiSummaryCard } from "@/components/sre/incidents/incident-ai-summary-card";
import { IncidentInvestigationSheet } from "@/components/sre/incidents/incident-investigation-sheet";
import { IncidentSidebar } from "@/components/sre/incidents/incident-sidebar";
import { IncidentStatusStepper } from "@/components/sre/incidents/incident-status-stepper";
import { IncidentTimeline } from "@/components/sre/incidents/incident-timeline";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { InvestigationHypotheses } from "@/components/sre/incidents/investigation-hypotheses";
import { InvestigationStepTrace } from "@/components/sre/incidents/investigation-step-trace";
import { PostmortemCard } from "@/components/sre/incidents/postmortem-card";
import { OPEN_POSTMORTEM_EVENT, ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
import { formatAge } from "@/components/sre/incidents/incident-age";
import { SreIncidentBriefPanel } from "@/components/sre/incidents/sre-incident-brief-panel";
import { SreInvestigationPanel, SreReportSnapshotControl } from "@/components/sre/incidents/sre-investigation-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  /** Legacy ?tab= deep link. Anything but "overview" opens the investigation sheet on that section. */
  initialTab?: "overview" | "investigation" | "evidence" | "brief";
};

const DEFAULT_SECTIONS = ["run", "hypotheses"];
const SECTIONS_FOR_TAB: Record<string, string[]> = {
  investigation: ["run", "hypotheses", "steps"],
  evidence: ["evidence"],
  brief: ["brief"],
};

const severityTones: Record<
  SreIncidentDetail["incident"]["severity"],
  TableBadgeTone
> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

function formatDate(value: Date | string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getBriefSummary(detail: SreIncidentDetail) {
  const snapshot = detail.latestBrief?.agentStateSnapshot;
  const summary =
    snapshot && typeof snapshot.summary === "string" ? snapshot.summary : null;
  return summary ?? null;
}

function getBriefProvider(detail: SreIncidentDetail) {
  const snapshot = detail.latestBrief?.agentStateSnapshot;
  return snapshot && typeof snapshot.provider === "string"
    ? snapshot.provider
    : null;
}

function NativeEvidenceCard({ detail }: { detail: SreIncidentDetail }) {
  if (detail.evidence.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h3 className="mt-2 text-sm font-medium">No evidence gathered yet</h3>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          Link a monitor or alert, then generate a brief to collect Supercheck evidence. Authorized live investigations
          can also collect connector evidence.
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border">
      <Table className="min-w-[520px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[38%]">Evidence</TableHead>
            <TableHead className="w-[34%]">Summary</TableHead>
            <TableHead className="w-[18%]">Observed</TableHead>
            <TableHead className="w-[10%] text-right">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.evidence.map((item) => (
            <TableRow key={item.id} id={`sre-evidence-${item.id}`} className="scroll-mt-24">
              <TableCell className="font-medium" title={item.title}>
                <span className="block truncate">{item.title}</span>
                <span className="text-xs font-normal capitalize text-muted-foreground">{item.evidenceType}</span>
              </TableCell>
              <TableCell className="truncate text-muted-foreground" title={item.summary ?? item.citationQuery ?? undefined}>
                {item.summary ?? item.citationQuery ?? "No summary"}
              </TableCell>
              <TableCell>
                <div className="inline-flex items-center gap-1 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span suppressHydrationWarning>{formatDate(item.observedAt)}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <EvidenceDetailsDialog item={item} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SreIncidentDetailView({
  detail,
  services,
  initialTab = "overview",
}: SreIncidentDetailViewProps) {
  const summary = getBriefSummary(detail);
  const provider = getBriefProvider(detail);
  const { incident, permissions } = detail;
  const open = incident.status !== "resolved";
  const investigation = detail.latestInvestigation;
  const display = getDisplayStatus(incident.status, incident.acknowledgedAt);

  const [sheetOpen, setSheetOpen] = useState(initialTab !== "overview");
  const [expanded, setExpanded] = useState<string[]>(SECTIONS_FOR_TAB[initialTab] ?? DEFAULT_SECTIONS);
  const [editOpen, setEditOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const openSheet = (sections?: string[]) => {
    if (sections) setExpanded((current) => Array.from(new Set([...current, ...sections])));
    setSheetOpen(true);
  };

  useEffect(() => {
    const onOpenPostmortem = () => openSheet(["postmortem"]);
    window.addEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
    return () => window.removeEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
  }, []);

  const needsAck = permissions.canUpdate && open && !incident.acknowledgedAt;
  const needsResolve = permissions.canUpdate && open && Boolean(incident.acknowledgedAt);

  const sections = [
    {
      id: "run",
      title: "Run controls",
      content: permissions.canInvestigate ? (
        <SreInvestigationPanel
          key={investigation?.id ?? "no-investigation"}
          incidentId={incident.id}
          hasPrimaryService={Boolean(incident.primaryServiceId)}
          serviceMappingHref={`/incidents/${incident.id}?edit=service`}
          canMapService={permissions.canUpdate}
          evidenceReferences={detail.evidence.map((item) => ({
            id: item.id,
            title: item.title,
            evidenceType: item.evidenceType,
          }))}
          toolMetrics={detail.toolMetrics}
          latestInvestigation={investigation}
          canInvestigate={permissions.canInvestigate}
          canUseLiveConnectors={permissions.canUseLiveConnectors}
          investigationEnabled={detail.capabilities.investigationEnabled}
        />
      ) : null,
    },
    {
      id: "hypotheses",
      title: "Hypotheses",
      content: investigation ? (
        <InvestigationHypotheses
          incidentId={incident.id}
          investigation={investigation}
          evidence={detail.evidence}
          canGiveFeedback={permissions.canUpdate}
        />
      ) : null,
    },
    {
      id: "steps",
      title: "Steps",
      content: investigation ? (
        <InvestigationStepTrace steps={investigation.steps} running={investigation.status === "running"} />
      ) : null,
    },
    { id: "evidence", title: `Evidence (${detail.evidence.length})`, content: <NativeEvidenceCard detail={detail} /> },
    {
      id: "brief",
      title: "Evidence brief",
      content: (
        <div className="h-[32rem] max-h-[70svh]">
          <SreIncidentBriefPanel
            key={`${incident.id}:${detail.latestBrief?.id ?? "no-brief"}`}
            incidentId={incident.id}
            incidentNumber={incident.incidentNumber}
            incidentTitle={incident.title}
            initialSummary={summary}
            initialProvider={provider}
            initialConfidenceScore={detail.latestBrief?.confidenceScore ?? null}
            hasBrief={Boolean(detail.latestBrief)}
            canGenerate={permissions.canInvestigate}
            totalEvidenceCount={detail.evidence.length}
            evidenceCount={
              typeof detail.latestBrief?.agentStateSnapshot?.evidenceCount === "number"
                ? detail.latestBrief.agentStateSnapshot.evidenceCount
                : null
            }
          />
        </div>
      ),
    },
    {
      id: "snapshot",
      title: "Report snapshot",
      content: investigation ? (
        <SreReportSnapshotControl
          key={investigation.id}
          incidentId={incident.id}
          latestInvestigation={investigation}
          latestReportSnapshot={detail.latestReportSnapshot}
          canInvestigate={permissions.canInvestigate}
        />
      ) : null,
    },
    {
      id: "postmortem",
      title: "Post-mortem",
      content: !open ? (
        <PostmortemCard
          key={incident.postmortem?.updatedAt ?? "none"}
          incidentId={incident.id}
          incidentNumber={incident.incidentNumber}
          title={incident.title}
          postmortem={incident.postmortem}
          canEdit={permissions.canUpdate}
        />
      ) : null,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden lg:overflow-hidden">
      <header className="shrink-0 space-y-2">
        <Button asChild variant="link" className="h-auto p-0 text-muted-foreground">
          <Link href="/incidents">
            <ArrowLeft className="h-4 w-4" />
            Incidents
          </Link>
        </Button>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h1 className="break-words text-xl font-semibold leading-tight">
              <span className="mr-2 text-muted-foreground">#{incident.incidentNumber}</span>
              {incident.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <TableBadge tone={severityTones[incident.severity]} className="uppercase">
                  {incident.severity}
                </TableBadge>
                <InfoTip label="About severity">
                  SEV1 is a customer-facing outage; SEV4 is minor with no customer impact.
                </InfoTip>
              </span>
              <span className="inline-flex items-center gap-1">
                <TableBadge tone={display.tone}>{display.label}</TableBadge>
                <InfoTip label="About status">{display.description}</InfoTip>
              </span>
              {incident.primaryServiceName && <span>{incident.primaryServiceName}</span>}
              <span aria-hidden="true">·</span>
              <span suppressHydrationWarning title={formatDate(incident.createdAt)}>
                opened {formatAge(incident.createdAt)} ago
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {needsAck && <AcknowledgeSreIncidentButton incidentId={incident.id} />}
            {needsResolve && (
              <ResolveSreIncidentDialog incidentId={incident.id} defaultSummary={incident.rootCauseSummary ?? ""} />
            )}
            {!open && (
              <Button size="sm" variant="outline" onClick={() => openSheet(["postmortem"])}>
                <FileText className="h-4 w-4" />
                Post-mortem
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {permissions.canUpdate && (
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
                )}
                {needsAck && <DropdownMenuItem onSelect={() => setResolveOpen(true)}>Resolve</DropdownMenuItem>}
                {permissions.canInvestigate && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href={`/copilot?incident=${incident.id}`}>Ask Copilot</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openSheet(["run"])}>
                      {investigation ? "Re-run investigation" : "Run investigation"}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem asChild>
                  <Link href={`/copilot/evidence-graph?incident=${incident.id}`}>Investigation map</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {incident.resolutionSummary && (
          <p className="line-clamp-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="resolution-summary">
            <span className="font-medium">Resolution: </span>
            {incident.resolutionSummary}
          </p>
        )}
      </header>

      <IncidentStatusStepper current={display.value} />

      <div className="grid min-w-0 shrink-0 gap-4 lg:min-h-0 lg:flex-1 lg:shrink lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <IncidentAiSummaryCard
            rootCauseSummary={incident.rootCauseSummary}
            confidenceScore={incident.confidenceScore}
            investigationStatus={investigation?.status ?? null}
            investigation={investigation}
            evidence={detail.evidence}
            onOpenDetails={() => openSheet()}
            canInvestigate={permissions.canInvestigate}
            feedback={
              permissions.canUpdate && investigation?.status === "completed" ? (
                <>
                  <span className="font-medium">Was this right?</span>
                  <InvestigationFeedback
                    key={`feedback:${investigation.id}`}
                    incidentId={incident.id}
                    investigationRunId={investigation.id}
                    initial={investigation.myFeedback.find((entry) => entry.hypothesisKey === null) ?? null}
                    label="this investigation"
                  />
                </>
              ) : null
            }
          />
          <IncidentTimeline incidentId={incident.id} canUpdate={permissions.canUpdate && open} />
        </div>
        <IncidentSidebar detail={detail} />
      </div>

      <IncidentInvestigationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        sections={sections}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      <EditSreIncidentDialog
        incident={incident}
        services={services}
        canUpdate={permissions.canUpdate}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {needsAck && (
        <ResolveSreIncidentDialog
          incidentId={incident.id}
          defaultSummary={incident.rootCauseSummary ?? ""}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
        />
      )}
    </div>
  );
}

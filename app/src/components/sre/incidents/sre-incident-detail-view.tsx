"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, Clock, FileSearch, FileText, History, MoreHorizontal, NotebookPen, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { AcknowledgeSreIncidentButton } from "@/components/sre/incidents/acknowledge-sre-incident-button";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { IncidentAiSummaryCard } from "@/components/sre/incidents/incident-ai-summary-card";
import { IncidentInvestigationSheet, type InvestigationTab } from "@/components/sre/incidents/incident-investigation-sheet";
import { IncidentSidebar } from "@/components/sre/incidents/incident-sidebar";
import { IncidentStatusStepper } from "@/components/sre/incidents/incident-status-stepper";
import { SimilarIncidentsList } from "@/components/sre/incidents/similar-incidents-card";
import { IncidentTimeline } from "@/components/sre/incidents/incident-timeline";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { InvestigationHypotheses } from "@/components/sre/incidents/investigation-hypotheses";
import { InvestigationStepTrace } from "@/components/sre/incidents/investigation-step-trace";
import { PostmortemCard } from "@/components/sre/incidents/postmortem-card";
import { OPEN_POSTMORTEM_EVENT, ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
import { formatAgo } from "@/components/sre/incidents/incident-age";
import { SreIncidentBriefPanel } from "@/components/sre/incidents/sre-incident-brief-panel";
import { SreInvestigationPanel, SreReportSnapshotControl } from "@/components/sre/incidents/sre-investigation-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  /** Legacy ?tab= deep link. Anything but "overview" opens the investigation sheet on that section. */
  initialTab?: "overview" | "investigation" | "evidence" | "brief";
};

const DEFAULT_TAB = "analysis";
// Legacy ?tab= deep links.
const SHEET_TAB_FOR_LINK: Record<string, string> = {
  investigation: "analysis",
  evidence: "evidence",
  brief: "brief",
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

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
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
  const [sheetTab, setSheetTab] = useState(SHEET_TAB_FOR_LINK[initialTab] ?? DEFAULT_TAB);
  const [editOpen, setEditOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [showCommander, setShowCommander] = useState(false);

  const openSheet = (tab: string = DEFAULT_TAB) => {
    setSheetTab(tab);
    setSheetOpen(true);
  };

  useEffect(() => {
    const onOpenPostmortem = () => openSheet("postmortem");
    window.addEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
    return () => window.removeEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
  }, []);

  const needsAck = permissions.canUpdate && open && !incident.acknowledgedAt;
  const needsResolve = permissions.canUpdate && open && Boolean(incident.acknowledgedAt);
  const canAddCommander = permissions.canUpdate && open && !incident.commanderUserId && !showCommander;

  const runPanel = permissions.canInvestigate ? (
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
  ) : null;

  const tabs: InvestigationTab[] = [
    {
      id: "analysis",
      title: "Analysis",
      icon: Sparkles,
      content:
        investigation || runPanel ? (
          <>
            {/* Findings first; the run controls follow once there is something to read. */}
            {!investigation && runPanel}
            {investigation && (
              <SheetSection title="Hypotheses">
                <InvestigationHypotheses
                  incidentId={incident.id}
                  investigation={investigation}
                  evidence={detail.evidence}
                  canGiveFeedback={permissions.canUpdate}
                />
              </SheetSection>
            )}
            {investigation && (
              // The trace carries its own "How I investigated" title.
              <InvestigationStepTrace steps={investigation.steps} running={investigation.status === "running"} />
            )}
            {investigation && runPanel}
            {investigation && (
              <SheetSection title="Report snapshot">
                <SreReportSnapshotControl
                  key={investigation.id}
                  incidentId={incident.id}
                  latestInvestigation={investigation}
                  latestReportSnapshot={detail.latestReportSnapshot}
                  canInvestigate={permissions.canInvestigate}
                />
              </SheetSection>
            )}
          </>
        ) : null,
    },
    {
      id: "evidence",
      title: `Evidence (${detail.evidence.length})`,
      icon: FileSearch,
      content: <NativeEvidenceCard detail={detail} />,
    },
    {
      id: "brief",
      title: "Brief",
      icon: FileText,
      content: (
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
      ),
    },
    { id: "similar", title: "Similar", icon: History, content: <SimilarIncidentsList incidentId={incident.id} /> },
    {
      id: "postmortem",
      title: "Post-mortem",
      icon: NotebookPen,
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
    <div className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {/* Same back control as the monitor and job detail pages. */}
          <Button asChild variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
            <Link href="/incidents" aria-label="Back to incidents">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 space-y-1.5">
            <h1 className="break-words text-xl font-semibold leading-tight">
              <span className="mr-2 text-muted-foreground">#{incident.incidentNumber}</span>
              {incident.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <TableBadge tone={severityTones[incident.severity]} compact className="uppercase">
                      {incident.severity}
                    </TableBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  SEV1 is a customer-facing outage; SEV4 is minor with no customer impact.
                </TooltipContent>
              </Tooltip>
              {incident.primaryServiceName && <span>{incident.primaryServiceName}</span>}
              {incident.primaryServiceName && <span aria-hidden="true">·</span>}
              <span suppressHydrationWarning title={formatDate(incident.createdAt)}>
                Opened {formatAgo(incident.createdAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
          {needsAck && <AcknowledgeSreIncidentButton incidentId={incident.id} />}
          {needsResolve && (
            <Button size="sm" onClick={() => setResolveOpen(true)}>
              <Check className="h-4 w-4" />
              Resolve incident
            </Button>
          )}
          {!open && (
            <Button size="sm" variant="outline" onClick={() => openSheet("postmortem")}>
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
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit incident</DropdownMenuItem>
              )}
              {canAddCommander && (
                <DropdownMenuItem onSelect={() => setShowCommander(true)}>Add commander</DropdownMenuItem>
              )}
              {needsAck && <DropdownMenuItem onSelect={() => setResolveOpen(true)}>Resolve incident</DropdownMenuItem>}
              {permissions.canInvestigate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openSheet("analysis")}>
                    {investigation ? "Re-run investigation" : "Run investigation"}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/copilot?incident=${incident.id}`}>Ask Copilot</Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href={`/copilot/evidence-graph?incident=${incident.id}`}>Investigation Map</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <IncidentStatusStepper current={display.value} acknowledged={Boolean(incident.acknowledgedAt)} description={display.description} />

      {incident.resolutionSummary && (
        <p className="line-clamp-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="resolution-summary">
          <span className="font-medium">Resolution: </span>
          {incident.resolutionSummary}
        </p>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
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
                <InvestigationFeedback
                  key={`feedback:${investigation.id}`}
                  incidentId={incident.id}
                  investigationRunId={investigation.id}
                  initial={investigation.myFeedback.find((entry) => entry.hypothesisKey === null) ?? null}
                  label="this investigation"
                  compact
                />
              ) : null
            }
          />
          <IncidentTimeline incidentId={incident.id} canUpdate={permissions.canUpdate && open} />
        </div>
        {/* Sticks below the app header while the timeline scrolls with the page. */}
        <div className="min-w-0 lg:sticky lg:top-16">
          <IncidentSidebar
            detail={detail}
            showCommander={showCommander}
            onOpenSimilar={() => openSheet("similar")}
          />
        </div>
      </div>

      <IncidentInvestigationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tabs={tabs}
        tab={sheetTab}
        onTabChange={setSheetTab}
      />
      <EditSreIncidentDialog
        incident={incident}
        services={services}
        canUpdate={permissions.canUpdate}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {/* One dialog for both entry points: the header button once acknowledged, the menu before. */}
      {(needsAck || needsResolve) && (
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

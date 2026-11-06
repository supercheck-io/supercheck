"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, FileText, LayoutDashboard, Loader2, MoreHorizontal, Sparkles } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { AcknowledgeSreIncidentButton } from "@/components/sre/incidents/acknowledge-sre-incident-button";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { IncidentAiSummaryCard, rootCauseFromBrief } from "@/components/sre/incidents/incident-ai-summary-card";
import { IncidentSidebar, SEVERITY_TONES } from "@/components/sre/incidents/incident-sidebar";
import { IncidentTimeline } from "@/components/sre/incidents/incident-timeline";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { InvestigationReport, type ReportFocus } from "@/components/sre/incidents/investigation-report";
import { PostmortemCard } from "@/components/sre/incidents/postmortem-card";
import { OPEN_POSTMORTEM_EVENT, ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
import { SimilarIncidentsCard } from "@/components/sre/incidents/similar-incidents-card";
import { SreInvestigationPanel } from "@/components/sre/incidents/sre-investigation-panel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TableBadge } from "@/components/ui/table-badge";
import { reportHeadline } from "@/lib/sre/evidence-brief-summary";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import { COLUMN_SCROLL, TAB_TRIGGER } from "@/components/sre/incidents/incident-ui";

type IncidentTab = "overview" | "investigation" | "postmortem";
/** The `?tab=` values the page accepts: the three tabs plus the legacy `evidence` and `brief` links. */
export type IncidentTabParam = IncidentTab | "evidence" | "brief";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  initialTab?: IncidentTabParam;
};

// Legacy ?tab= links open the Investigation tab on the matching section.
const FOCUS_FOR_LINK: Partial<Record<IncidentTabParam, string>> = {
  evidence: "evidence",
  brief: "conclusion",
};

/** Pre-fills the resolve dialog with one paragraph; the person still reads and confirms it. */
export function defaultResolutionNote(recoveredAt: string | null | undefined, rootCause: string | null) {
  const recovery = recoveredAt
    ? `The checks that raised this incident recovered on ${new Date(recoveredAt).toUTCString()} and are passing again.`
    : "";
  return [recovery, reportHeadline(rootCause) ?? ""].filter(Boolean).join("\n\n");
}

/** Keeps the open tab in the URL so it survives a reload and can be shared. */
function writeTabToUrl(tab: IncidentTab) {
  const url = new URL(window.location.href);
  if (tab === "overview") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}

export function SreIncidentDetailView({
  detail,
  services,
  initialTab = "overview",
}: SreIncidentDetailViewProps) {
  const { incident, permissions } = detail;
  const open = incident.status !== "resolved";
  const investigation = detail.latestInvestigation;
  const display = getDisplayStatus(incident.status, incident.acknowledgedAt);

  // #sre-evidence-<id> links open the Investigation tab on that evidence item. The view mounts client-side only.
  const [hashTarget] = useState(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#sre-evidence-") ? window.location.hash.slice(1) : null,
  );
  const [tab, setTab] = useState<IncidentTab>(
    hashTarget || initialTab === "evidence" || initialTab === "brief" ? "investigation" : initialTab,
  );
  const [focus, setFocus] = useState<ReportFocus | null>(
    hashTarget ? { target: hashTarget, n: 0 } : FOCUS_FOR_LINK[initialTab] ? { target: FOCUS_FOR_LINK[initialTab]!, n: 0 } : null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [showCommander, setShowCommander] = useState(false);

  // The post-mortem tab exists once the incident is resolved; asking for it earlier shows the overview.
  const activeTab: IncidentTab = tab === "postmortem" && open ? "overview" : tab;

  const mainColumn = useRef<HTMLDivElement>(null);

  const changeTab = (value: string) => {
    const next = value as IncidentTab;
    setTab(next);
    setFocus(null);
    // Each tab starts at its top; the column would otherwise keep the previous tab's scroll position.
    if (mainColumn.current) mainColumn.current.scrollTop = 0;
    writeTabToUrl(next);
  };

  useEffect(() => {
    // Back and Forward change ?tab= without remounting the view (it is keyed by incident), so follow the URL.
    const onPopState = () => {
      const param = new URL(window.location.href).searchParams.get("tab") as IncidentTabParam | null;
      setTab(param === "investigation" || param === "evidence" || param === "brief" ? "investigation" : param === "postmortem" ? "postmortem" : "overview");
      const target = param ? FOCUS_FOR_LINK[param] : undefined;
      setFocus((current) => (target ? { target, n: (current?.n ?? 0) + 1 } : null));
      // Same as changeTab: the tab starts at its top.
      if (mainColumn.current) mainColumn.current.scrollTop = 0;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // The resolve toast's Post-mortem action; the detail refetch after resolving makes the tab appear.
    const onOpenPostmortem = () => {
      setTab("postmortem");
      writeTabToUrl("postmortem");
    };
    window.addEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
    return () => window.removeEventListener(OPEN_POSTMORTEM_EVENT, onOpenPostmortem);
  }, []);

  const needsAck = permissions.canUpdate && open && !incident.acknowledgedAt;
  const needsResolve = permissions.canUpdate && open && Boolean(incident.acknowledgedAt);
  const canAddCommander = permissions.canUpdate && open && !incident.commanderUserId && !showCommander;
  const fromBrief = rootCauseFromBrief(detail);
  const summarySource = fromBrief ? "brief" : investigation ? "investigation" : "triage";

  const runControls = permissions.canInvestigate ? (
    <SreInvestigationPanel
      key={investigation?.id ?? "no-investigation"}
      incidentId={incident.id}
      hasPrimaryService={Boolean(incident.primaryServiceId)}
      serviceMappingHref={`/incidents/${incident.id}?edit=service`}
      canMapService={permissions.canUpdate}
      latestInvestigation={investigation}
      canInvestigate={permissions.canInvestigate}
      canUseLiveConnectors={permissions.canUseLiveConnectors}
      investigationEnabled={detail.capabilities.investigationEnabled}
    />
  ) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
      <header className="shrink-0 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Button asChild variant="outline" size="icon" className="h-8 w-8 shrink-0">
              <Link href="/incidents">
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Back to incidents</span>
              </Link>
            </Button>
            <h1 className="min-w-0 break-words text-xl font-semibold leading-tight sm:text-2xl">
              <span className="mr-2 text-muted-foreground">#{incident.incidentNumber}</span>
              {incident.title}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <TableBadge tone={display.tone} compact>
                      {display.label}
                    </TableBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">{display.description}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <TableBadge tone={SEVERITY_TONES[incident.severity]} compact className="uppercase">
                      {incident.severity}
                    </TableBadge>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  SEV1 is a customer-facing outage; SEV4 is minor with no customer impact.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {needsAck && <AcknowledgeSreIncidentButton incidentId={incident.id} />}
            {needsResolve && (
              <Button size="sm" onClick={() => setResolveOpen(true)}>
                <Check className="h-4 w-4" />
                Resolve incident
              </Button>
            )}
            {(permissions.canUpdate || permissions.canInvestigate) && (
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
                      {permissions.canUpdate && <DropdownMenuSeparator />}
                      <DropdownMenuItem asChild>
                        <Link href={`/copilot?incident=${incident.id}`}>Ask Copilot</Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      {/* Tabs sit above both columns so the first card on each side starts on the same line. */}
      <Tabs value={activeTab} onValueChange={changeTab} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <TabsList className="h-auto w-full shrink-0 flex-wrap justify-start self-start sm:w-auto">
          <TabsTrigger value="overview" className={TAB_TRIGGER}>
            <LayoutDashboard aria-hidden="true" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="investigation" className={TAB_TRIGGER}>
            <Sparkles aria-hidden="true" />
            Investigation
            {investigation?.status === "running" && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
          </TabsTrigger>
          {!open && (
            <TabsTrigger value="postmortem" className={TAB_TRIGGER}>
              <FileText aria-hidden="true" />
              Post-mortem
            </TabsTrigger>
          )}
        </TabsList>

        <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
          <div ref={mainColumn} className={`flex min-w-0 flex-col ${COLUMN_SCROLL}`}>

            {/* Kept mounted while hidden so an unsent note or a draft survives a tab switch. */}
            <TabsContent
              value="overview"
              forceMount
              hidden={activeTab !== "overview"}
              className="mt-0 flex min-w-0 flex-col gap-4 focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=inactive]:hidden"
            >
              {/* The resolution is in the Resolved activity row and the post-mortem; the Summary card is the one paragraph here. */}
              <IncidentAiSummaryCard
                rootCauseSummary={incident.rootCauseSummary ?? detail.triageSummary ?? null}
                confidenceScore={incident.confidenceScore}
                investigationStatus={investigation?.status ?? null}
                investigation={investigation}
                onOpenInvestigation={() => changeTab("investigation")}
                runControls={runControls}
                source={summarySource}
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
              <IncidentTimeline
                incidentId={incident.id}
                canUpdate={permissions.canUpdate && open}
                canPostToStatusPage={
                  Boolean(permissions.canPostToStatusPage) &&
                  ["investigating", "identified", "monitoring"].includes(detail.publicIncident?.status ?? "")
                }
              />
            </TabsContent>

            {/* Kept mounted while hidden so a streaming brief and the run options survive a tab switch. */}
            <TabsContent
              value="investigation"
              forceMount
              hidden={activeTab !== "investigation"}
              className="mt-0 min-w-0 rounded-md focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=inactive]:hidden"
            >
              <InvestigationReport
                key={detail.latestBrief?.id ?? "no-brief"}
                detail={detail}
                focus={focus}
                serviceMappingHref={`/incidents/${incident.id}?edit=service`}
              />
            </TabsContent>

            {!open && (
              // Kept mounted while hidden so unsaved post-mortem edits survive a tab switch.
              <TabsContent
                value="postmortem"
                forceMount
                hidden={activeTab !== "postmortem"}
                className="mt-0 min-w-0 rounded-md focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=inactive]:hidden"
              >
                <PostmortemCard
                      key={incident.postmortem?.updatedAt ?? "none"}
                      incidentId={incident.id}
                      incidentNumber={incident.incidentNumber}
                      title={incident.title}
                      postmortem={incident.postmortem}
                      canEdit={permissions.canUpdate}
                    />
              </TabsContent>
            )}
          </div>
          {/* Not sticky: with alerts and similar incidents the column can be taller than the window. */}
          <aside aria-label="Incident details" className={`flex min-w-0 flex-col gap-4 ${COLUMN_SCROLL}`}>
            <IncidentSidebar detail={detail} showCommander={showCommander} />
            <SimilarIncidentsCard incidentId={incident.id} />
          </aside>
        </div>
      </Tabs>

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
          defaultSummary={defaultResolutionNote(detail.recoveredAt, incident.rootCauseSummary)}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
        />
      )}
    </div>
  );
}

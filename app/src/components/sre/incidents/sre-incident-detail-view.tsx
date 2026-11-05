"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, MoreHorizontal } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { AcknowledgeSreIncidentButton } from "@/components/sre/incidents/acknowledge-sre-incident-button";
import { IncidentCopilotSheet } from "@/components/sre/incidents/incident-copilot-sheet";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { IncidentAiSummaryCard } from "@/components/sre/incidents/incident-ai-summary-card";
import { IncidentInvestigationSheet } from "@/components/sre/incidents/incident-investigation-sheet";
import { IncidentSidebar, SEVERITY_TONES } from "@/components/sre/incidents/incident-sidebar";
import { IncidentTimeline } from "@/components/sre/incidents/incident-timeline";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { InvestigationReport, type ReportFocus } from "@/components/sre/incidents/investigation-report";
import { OPEN_POSTMORTEM_EVENT, ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TableBadge } from "@/components/ui/table-badge";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  /** Legacy ?tab= deep link. Anything but "overview" opens the investigation sheet on that section. */
  initialTab?: "overview" | "investigation" | "evidence" | "brief";
};

// Legacy ?tab= deep links land on the matching section of the one-page report.
const FOCUS_FOR_LINK: Record<string, string> = {
  investigation: "conclusion",
  evidence: "evidence",
  brief: "conclusion",
};

/** Pre-fills the resolve dialog; the person still reads and confirms it. */
export function defaultResolutionNote(recoveredAt: string | null | undefined, rootCause: string | null) {
  const recovery = recoveredAt
    ? `The checks that raised this incident recovered on ${new Date(recoveredAt).toUTCString()} and are passing again.`
    : "";
  return [recovery, rootCause ?? ""].filter(Boolean).join("\n\n");
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

  // #sre-evidence-<id> links open the sheet on that evidence item. The view mounts client-side only, after the query resolves.
  const [hashTarget] = useState(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#sre-evidence-") ? window.location.hash.slice(1) : null,
  );
  const [sheetOpen, setSheetOpen] = useState(initialTab !== "overview" || hashTarget !== null);
  const [focus, setFocus] = useState<ReportFocus | null>(
    hashTarget
      ? { target: hashTarget, n: 0 }
      : initialTab !== "overview"
        ? { target: FOCUS_FOR_LINK[initialTab] ?? "conclusion", n: 0 }
        : null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [showCommander, setShowCommander] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const openSheet = (target = "conclusion") => {
    setFocus((current) => ({ target, n: (current?.n ?? 0) + 1 }));
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="rounded-lg border bg-card p-2 shadow-sm">
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
                      <DropdownMenuItem onSelect={() => setCopilotOpen(true)}>Ask Copilot</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {incident.resolutionSummary && (
            <p className="line-clamp-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="resolution-summary">
              <span className="font-medium">{incident.status === "resolved" ? "Resolution: " : "Previous resolution: "}</span>
              {incident.resolutionSummary}
            </p>
          )}
          <IncidentAiSummaryCard
            rootCauseSummary={incident.rootCauseSummary ?? detail.triageSummary ?? null}
            confidenceScore={incident.confidenceScore}
            investigationStatus={investigation?.status ?? null}
            investigation={investigation}
            onOpenInvestigation={() => openSheet()}
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
          <IncidentTimeline
            incidentId={incident.id}
            canUpdate={permissions.canUpdate && open}
            canPostToStatusPage={
              Boolean(permissions.canPostToStatusPage) &&
              ["investigating", "identified", "monitoring"].includes(detail.publicIncident?.status ?? "")
            }
          />
        </div>
        {/* Sticks below the app header while the activity feed scrolls with the page. */}
        <div className="min-w-0 lg:sticky lg:top-16">
          <IncidentSidebar detail={detail} showCommander={showCommander} />
        </div>
      </div>

      <IncidentInvestigationSheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <InvestigationReport detail={detail} focus={focus} serviceMappingHref={`/incidents/${incident.id}?edit=service`} />
      </IncidentInvestigationSheet>
      {permissions.canInvestigate && (
        <IncidentCopilotSheet open={copilotOpen} onOpenChange={setCopilotOpen} incidentId={incident.id} />
      )}
      <EditSreIncidentDialog
        incident={incident}
        services={services}
        canUpdate={permissions.canUpdate}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      {/* One dialog for both entry points: the the header button once acknowledged, the menu before. */}
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

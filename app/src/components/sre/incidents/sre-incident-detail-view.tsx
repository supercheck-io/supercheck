import Link from "next/link";
import { AlertTriangle, ArrowLeft, Clock, Bot, Database } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { SreIncidentBriefPanel } from "@/components/sre/incidents/sre-incident-brief-panel";
import { SreInvestigationPanel } from "@/components/sre/incidents/sre-investigation-panel";
import { ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
import { AcknowledgeSreIncidentButton } from "@/components/sre/incidents/acknowledge-sre-incident-button";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { InvestigationHypotheses } from "@/components/sre/incidents/investigation-hypotheses";
import { InvestigationStepTrace } from "@/components/sre/incidents/investigation-step-trace";
import { PostmortemCard } from "@/components/sre/incidents/postmortem-card";
import { IncidentAiSummaryCard } from "@/components/sre/incidents/incident-ai-summary-card";
import { IncidentSidebar } from "@/components/sre/incidents/incident-sidebar";
import { IncidentTimeline } from "@/components/sre/incidents/incident-timeline";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  initialTab?: "overview" | "investigation" | "evidence" | "brief";
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

const statusTones: Record<
  SreIncidentDetail["incident"]["status"],
  TableBadgeTone
> = {
  triggered: "danger",
  investigating: "info",
  identified: "purple",
  recommendations_ready: "info",
  user_applying_fix: "indigo",
  verifying: "warning",
  resolved: "success",
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

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
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
  return (
    <Card className="overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="h-5 w-5" />
          Incident evidence
        </CardTitle>
        <CardDescription>
          Saved observations from Supercheck and connected sources. Open an item
          to review its full summary and query reference.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {detail.evidence.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">
              No evidence gathered yet
            </h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Link a monitor or alert, then generate a brief to collect
              Supercheck evidence. Authorized live investigations can also
              collect connector evidence.
            </p>
          </div>
        ) : (
          <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border">
            <Table className="min-w-[760px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[35%]">Evidence</TableHead>
                  <TableHead className="w-[37%]">Summary</TableHead>
                  <TableHead className="w-[20%]">Observed</TableHead>
                  <TableHead className="w-[8%] text-right">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.evidence.map((item) => (
                  <TableRow
                    key={item.id}
                    id={`sre-evidence-${item.id}`}
                    className="scroll-mt-24"
                  >
                    <TableCell className="font-medium" title={item.title}>
                      <span className="block truncate">{item.title}</span>
                      <span className="text-xs font-normal capitalize text-muted-foreground">
                        {item.evidenceType}
                      </span>
                    </TableCell>
                    <TableCell
                      className="truncate text-muted-foreground"
                      title={item.summary ?? item.citationQuery ?? undefined}
                    >
                      {item.summary ?? item.citationQuery ?? "No summary"}
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-1 text-sm">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span suppressHydrationWarning>
                          {formatDate(item.observedAt)}
                        </span>
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
        )}
      </CardContent>
    </Card>
  );
}

type IncidentTab = "overview" | "investigation" | "evidence";

function tabFor(
  initialTab: SreIncidentDetailViewProps["initialTab"],
): IncidentTab {
  if (initialTab === "evidence" || initialTab === "brief") return "evidence";
  return initialTab === "investigation" ? "investigation" : "overview";
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overflow-x-hidden">
      <header className="shrink-0 space-y-3">
        <Button
          asChild
          variant="link"
          className="h-auto p-0 text-muted-foreground"
        >
          <Link href="/incidents">
            <ArrowLeft className="h-4 w-4" />
            Incidents
          </Link>
        </Button>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-2xl font-semibold leading-tight">
              <span className="mr-2 text-muted-foreground">
                #{incident.incidentNumber}
              </span>
              {incident.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <TableBadge
                tone={severityTones[incident.severity]}
                className="uppercase"
              >
                {incident.severity}
              </TableBadge>
              <TableBadge
                tone={statusTones[incident.status]}
                className="capitalize"
              >
                {formatStatus(incident.status)}
              </TableBadge>
              <span suppressHydrationWarning>
                Opened {formatDate(incident.createdAt)}
              </span>
              {incident.primaryServiceName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{incident.primaryServiceName}</span>
                </>
              )}
              {incident.acknowledgedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Acknowledged</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {permissions.canInvestigate && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/copilot?incident=${incident.id}`}>
                  <Bot className="h-4 w-4" />
                  Ask Copilot
                </Link>
              </Button>
            )}
            <EditSreIncidentDialog
              incident={incident}
              services={services}
              canUpdate={permissions.canUpdate}
            />
            {permissions.canUpdate && open && !incident.acknowledgedAt && (
              <AcknowledgeSreIncidentButton incidentId={incident.id} />
            )}
            {permissions.canUpdate && open && (
              <ResolveSreIncidentDialog
                incidentId={incident.id}
                defaultSummary={incident.rootCauseSummary ?? ""}
              />
            )}
          </div>
        </div>
        {incident.resolutionSummary && (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm"
            data-testid="resolution-summary"
          >
            <span className="font-medium">Resolution: </span>
            {incident.resolutionSummary}
          </p>
        )}
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Tabs defaultValue={tabFor(initialTab)} className="min-w-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="investigation">Investigation</TabsTrigger>
            <TabsTrigger value="evidence">
              Evidence
              {detail.evidence.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {detail.evidence.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6">
            <IncidentAiSummaryCard
              rootCauseSummary={incident.rootCauseSummary}
              confidenceScore={incident.confidenceScore}
              investigationStatus={investigation?.status ?? null}
              investigation={investigation}
              evidence={detail.evidence}
              incidentId={incident.id}
            >
              {investigation && (
                <InvestigationHypotheses
                  incidentId={incident.id}
                  investigation={investigation}
                  evidence={detail.evidence}
                  canGiveFeedback={permissions.canUpdate}
                />
              )}
            </IncidentAiSummaryCard>
            {!open && (
              <PostmortemCard
                key={incident.postmortem?.updatedAt ?? "none"}
                incidentId={incident.id}
                incidentNumber={incident.incidentNumber}
                title={incident.title}
                postmortem={incident.postmortem}
                canEdit={permissions.canUpdate}
              />
            )}
            <IncidentTimeline
              incidentId={incident.id}
              canUpdate={permissions.canUpdate && open}
            />
          </TabsContent>

          <TabsContent
            value="investigation"
            className="mt-4 space-y-6"
            id="incident-investigation"
          >
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
              latestReportSnapshot={detail.latestReportSnapshot}
              myReportFeedback={detail.myReportFeedback}
              canInvestigate={permissions.canInvestigate}
              canUseLiveConnectors={permissions.canUseLiveConnectors}
              investigationEnabled={detail.capabilities.investigationEnabled}
            />
            {investigation && (
              <InvestigationStepTrace
                steps={investigation.steps}
                running={investigation.status === "running"}
              />
            )}
            {permissions.canUpdate && investigation?.status === "completed" && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                <span className="text-sm font-medium">
                  Was this investigation right?
                </span>
                <InvestigationFeedback
                  key={`feedback:${investigation.id}`}
                  incidentId={incident.id}
                  investigationRunId={investigation.id}
                  initial={
                    investigation.myFeedback.find(
                      (entry) => entry.hypothesisKey === null,
                    ) ?? null
                  }
                  label="this investigation"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="evidence" className="mt-4 space-y-6">
            <NativeEvidenceCard detail={detail} />
            <details
              className="rounded-lg border"
              open={initialTab === "brief"}
            >
              <summary className="cursor-pointer rounded-lg px-5 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Evidence brief · Summarize or export evidence
              </summary>
              <div className="h-[min(40rem,75svh)] min-h-96 p-3">
                <SreIncidentBriefPanel
                  key={`${incident.id}:${detail.latestBrief?.id ?? "no-brief"}`}
                  incidentId={incident.id}
                  incidentNumber={incident.incidentNumber}
                  incidentTitle={incident.title}
                  initialSummary={summary}
                  initialProvider={provider}
                  initialConfidenceScore={
                    detail.latestBrief?.confidenceScore ?? null
                  }
                  hasBrief={Boolean(detail.latestBrief)}
                  canGenerate={permissions.canInvestigate}
                  totalEvidenceCount={detail.evidence.length}
                  evidenceCount={
                    typeof detail.latestBrief?.agentStateSnapshot
                      ?.evidenceCount === "number"
                      ? detail.latestBrief.agentStateSnapshot.evidenceCount
                      : null
                  }
                />
              </div>
            </details>
          </TabsContent>
        </Tabs>
        <IncidentSidebar detail={detail} />
      </div>
    </div>
  );
}

import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Bot,
  Database,
  Network,
} from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { SreIncidentBriefPanel } from "@/components/sre/incidents/sre-incident-brief-panel";
import { SreInvestigationPanel } from "@/components/sre/incidents/sre-investigation-panel";
import { ResolveSreIncidentDialog } from "@/components/sre/incidents/resolve-sre-incident-dialog";
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
  initialTab?: "investigation" | "evidence" | "brief";
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

export function SreIncidentDetailView({
  detail,
  services,
  initialTab = "investigation",
}: SreIncidentDetailViewProps) {
  const summary = getBriefSummary(detail);
  const provider = getBriefProvider(detail);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto overflow-x-hidden lg:overflow-hidden">
      <div className="shrink-0 space-y-4">
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <TableBadge tone="info">
                Incident #{detail.incident.incidentNumber}
              </TableBadge>
              <TableBadge
                tone={severityTones[detail.incident.severity]}
                className="uppercase"
              >
                {detail.incident.severity}
              </TableBadge>
              <TableBadge
                tone={statusTones[detail.incident.status]}
                className="capitalize"
              >
                {formatStatus(detail.incident.status)}
              </TableBadge>
            </div>
            <h1 className="max-w-5xl break-words text-xl font-semibold leading-snug md:text-2xl">
              {detail.incident.title}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.permissions.canInvestigate && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/copilot?incident=${detail.incident.id}`}>
                  <Bot className="h-4 w-4" />
                  Open Copilot
                </Link>
              </Button>
            )}
            <EditSreIncidentDialog
              incident={detail.incident}
              services={services}
              canUpdate={detail.permissions.canUpdate}
            />
            {detail.permissions.canUpdate &&
              detail.incident.status !== "resolved" && (
                <ResolveSreIncidentDialog incidentId={detail.incident.id} />
              )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {detail.incident.primaryServiceId ? (
            <Link
              className="text-foreground underline underline-offset-4"
              href={`/services/${detail.incident.primaryServiceId}`}
            >
              {detail.incident.primaryServiceName ?? "Service"}
            </Link>
          ) : detail.permissions.canUpdate ? (
            <Link
              className="underline underline-offset-4"
              href={`/incidents/${detail.incident.id}?edit=service`}
            >
              Link service (optional)
            </Link>
          ) : (
            <span>No service linked</span>
          )}
          <span>
            {detail.incident.alertCount} alert
            {detail.incident.alertCount === 1 ? "" : "s"}
          </span>
          <span>
            {detail.evidence.length} evidence item
            {detail.evidence.length === 1 ? "" : "s"}
          </span>
          <span suppressHydrationWarning>
            Updated {formatDate(detail.incident.updatedAt)}
          </span>
          <Button asChild variant="ghost" size="sm" className="h-7">
            <Link
              href={`/copilot/evidence-graph?incident=${detail.incident.id}`}
            >
              <Network className="h-4 w-4" />
              View map
            </Link>
          </Button>
        </div>
      </div>

      <Tabs
        defaultValue={initialTab === "brief" ? "evidence" : initialTab}
        className="flex shrink-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden"
      >
        <TabsList className="shrink-0 justify-start self-start">
          <TabsTrigger value="investigation">Overview</TabsTrigger>
          <TabsTrigger value="evidence">Evidence &amp; brief</TabsTrigger>
        </TabsList>

        <TabsContent
          value="investigation"
          className="overflow-x-hidden lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          <SreInvestigationPanel
            key={detail.latestInvestigation?.id ?? "no-investigation"}
            incidentId={detail.incident.id}
            hasPrimaryService={Boolean(detail.incident.primaryServiceId)}
            serviceMappingHref={`/incidents/${detail.incident.id}?edit=service`}
            canMapService={detail.permissions.canUpdate}
            evidenceReferences={detail.evidence.map((item) => ({
              id: item.id,
              title: item.title,
              evidenceType: item.evidenceType,
            }))}
            toolMetrics={detail.toolMetrics}
            latestInvestigation={detail.latestInvestigation}
            latestReportSnapshot={detail.latestReportSnapshot}
            myReportFeedback={detail.myReportFeedback}
            canInvestigate={detail.permissions.canInvestigate}
            canUseLiveConnectors={detail.permissions.canUseLiveConnectors}
            investigationEnabled={detail.capabilities.investigationEnabled}
          />
        </TabsContent>

        <TabsContent
          value="evidence"
          className="space-y-4 overflow-x-hidden lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          <details className="rounded-lg border" open={initialTab === "brief"}>
            <summary className="cursor-pointer rounded-lg px-5 py-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Evidence brief · Summarize or export evidence
            </summary>
            <div className="h-[min(40rem,75svh)] min-h-96 p-3">
              <SreIncidentBriefPanel
                key={`${detail.incident.id}:${detail.latestBrief?.id ?? "no-brief"}`}
                incidentId={detail.incident.id}
                incidentNumber={detail.incident.incidentNumber}
                incidentTitle={detail.incident.title}
                initialSummary={summary}
                initialProvider={provider}
                initialConfidenceScore={
                  detail.latestBrief?.confidenceScore ?? null
                }
                hasBrief={Boolean(detail.latestBrief)}
                canGenerate={detail.permissions.canInvestigate}
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
          <NativeEvidenceCard detail={detail} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

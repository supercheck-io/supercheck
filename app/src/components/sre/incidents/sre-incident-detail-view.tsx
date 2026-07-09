import Link from "next/link";
import {
  AlertTriangle,
  Clock,
  Database,
  ExternalLink,
} from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import type { SreServiceListItem } from "@/actions/sre-services";
import { EditSreIncidentDialog } from "@/components/sre/incidents/edit-sre-incident-dialog";
import { SreIncidentBriefPanel } from "@/components/sre/incidents/sre-incident-brief-panel";
import { SreInvestigationPanel } from "@/components/sre/incidents/sre-investigation-panel";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type SreIncidentDetailViewProps = {
  detail: SreIncidentDetail;
  services: SreServiceListItem[];
  initialTab?: "investigation" | "evidence" | "brief";
};

const severityClasses: Record<
  SreIncidentDetail["incident"]["severity"],
  string
> = {
  sev1: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  sev2: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
  sev3: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  sev4: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
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
    snapshot && typeof snapshot.summary === "string"
      ? snapshot.summary
      : detail.incident.rootCauseSummary;
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
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="h-5 w-5" />
          Native evidence
        </CardTitle>
        <CardDescription>
          Stored citations from SuperCheck alerts, monitors, runs, logs,
          reports, and k6 results.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        {detail.evidence.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">
              No evidence gathered yet
            </h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Native evidence appears here after generating a brief.
            </p>
          </div>
        ) : (
          <div className="min-h-0 min-w-0 overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%]">Evidence</TableHead>
                  <TableHead className="w-[32%]">Summary</TableHead>
                  <TableHead className="w-[10%]">Type</TableHead>
                  <TableHead className="w-[10%]">Confidence</TableHead>
                  <TableHead className="w-[12%]">Observed</TableHead>
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
                    <TableCell className="truncate font-medium">
                      {item.title}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {item.summary ?? item.citationQuery ?? "No summary"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {item.evidenceType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.confidence
                        ? `${Math.round(Number(item.confidence) * 100)}%`
                        : "Unknown"}
                    </TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-1 text-sm">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span suppressHydrationWarning>
                          {formatDate(item.observedAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.sourceUri.startsWith("http://") ||
                      item.sourceUri.startsWith("https://") ? (
                        <a
                          href={item.sourceUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-end gap-1 text-sm text-primary hover:underline"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link
                          href={item.sourceUri}
                          className="inline-flex items-center justify-end gap-1 text-sm text-primary hover:underline"
                        >
                          View
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
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
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <div className="shrink-0 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                Incident #{detail.incident.incidentNumber}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "uppercase",
                  severityClasses[detail.incident.severity] ?? "",
                )}
              >
                {detail.incident.severity}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {formatStatus(detail.incident.status)}
              </Badge>
            </div>
            <h2 className="max-w-5xl text-xl font-semibold leading-snug tracking-tight md:text-2xl">
              {detail.incident.title}
            </h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Review the current response state, available evidence, and
              investigation readiness for this incident.
            </p>
          </div>
          <EditSreIncidentDialog
            incident={detail.incident}
            services={services}
            canUpdate={detail.permissions.canUpdate}
          />
        </div>

        <div className="grid overflow-hidden rounded-lg border bg-muted/10 sm:grid-cols-3">
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Service
            </p>
            <p className="mt-1 truncate text-sm font-semibold">
              {detail.incident.primaryServiceName ?? "Unmapped"}
            </p>
          </div>
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidence
            </p>
            <p className="mt-1 text-sm font-semibold">
              {detail.evidence.length}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Updated
            </p>
            <p className="mt-1 text-sm font-semibold" suppressHydrationWarning>
              {formatDate(detail.incident.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      <Tabs
        defaultValue={initialTab}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <TabsList className="shrink-0 justify-start self-start">
          <TabsTrigger value="investigation">Investigation</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="brief">Brief</TabsTrigger>
        </TabsList>

        <TabsContent
          value="investigation"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <SreInvestigationPanel
            incidentId={detail.incident.id}
            hasPrimaryService={Boolean(detail.incident.primaryServiceName)}
            serviceMappingHref="/org-admin?tab=services"
            evidenceReferences={detail.evidence.map((item) => ({
              id: item.id,
              title: item.title,
              evidenceType: item.evidenceType,
            }))}
          />
        </TabsContent>

        <TabsContent value="evidence" className="min-h-0 flex-1 overflow-hidden">
          <NativeEvidenceCard detail={detail} />
        </TabsContent>

        <TabsContent value="brief" className="min-h-0 flex-1 overflow-hidden">
          <SreIncidentBriefPanel
            incidentId={detail.incident.id}
            incidentNumber={detail.incident.incidentNumber}
            incidentTitle={detail.incident.title}
            initialSummary={summary}
            initialProvider={provider}
            initialConfidenceScore={detail.latestBrief?.confidenceScore ?? null}
            hasBrief={Boolean(detail.latestBrief)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

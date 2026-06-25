import Link from "next/link";
import { AlertTriangle, Clock, Database, ExternalLink, FileText, Siren } from "lucide-react";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { GenerateEvidenceBriefButton } from "@/components/sre/incidents/generate-evidence-brief-button";
import { SreInvestigationPanel } from "@/components/sre/incidents/sre-investigation-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
};

const severityClasses: Record<SreIncidentDetail["incident"]["severity"], string> = {
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
  const summary = snapshot && typeof snapshot.summary === "string" ? snapshot.summary : detail.incident.rootCauseSummary;
  return summary ?? null;
}

function getBriefProvider(detail: SreIncidentDetail) {
  const snapshot = detail.latestBrief?.agentStateSnapshot;
  return snapshot && typeof snapshot.provider === "string" ? snapshot.provider : null;
}

function EvidenceBriefCard({ detail, summary, provider }: { detail: SreIncidentDetail; summary: string | null; provider: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Siren className="h-5 w-5" />
          Evidence brief
        </CardTitle>
        <CardDescription>
          Claims are limited to native SuperCheck evidence and cite stored evidence items.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {detail.latestBrief?.rootCauseHypothesis && (
                <Badge variant="secondary">{detail.latestBrief.rootCauseHypothesis}</Badge>
              )}
              {detail.latestBrief?.confidenceScore != null && (
                <Badge variant="outline">Confidence {Math.round(Number(detail.latestBrief.confidenceScore) * 100)}%</Badge>
              )}
              {provider && <Badge variant="outline">{provider === "ai" ? "AI generated" : "Fallback brief"}</Badge>}
            </div>
            <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{summary}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">No evidence brief generated</h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Generate a native brief to gather SuperCheck evidence and produce a cited incident summary.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NativeEvidenceCard({ detail }: { detail: SreIncidentDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="h-5 w-5" />
          Native evidence
        </CardTitle>
        <CardDescription>Stored citations from SuperCheck alerts, monitors, runs, logs, reports, and k6 results.</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.evidence.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-3 text-base font-medium">No evidence gathered yet</h3>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Native evidence appears here after generating a brief.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Observed</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.evidence.map((item) => (
                  <TableRow key={item.id} id={`sre-evidence-${item.id}`} className="scroll-mt-24">
                    <TableCell className="min-w-[320px] whitespace-normal">
                      <div className="space-y-1">
                        <p className="font-medium">{item.title}</p>
                        {item.summary && <p className="text-xs text-muted-foreground">{item.summary}</p>}
                        {item.citationQuery && <p className="font-mono text-[11px] text-muted-foreground">{item.citationQuery}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{item.evidenceType}</Badge>
                    </TableCell>
                    <TableCell>{item.confidence ? `${Math.round(Number(item.confidence) * 100)}%` : "Unknown"}</TableCell>
                    <TableCell>
                      <div className="inline-flex items-center gap-1 text-sm">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatDate(item.observedAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {item.sourceUri.startsWith("http://") || item.sourceUri.startsWith("https://") ? (
                        <a href={item.sourceUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                          Open source
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link href={item.sourceUri} className="text-sm text-primary hover:underline">
                          Open source
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

export function SreIncidentDetailView({ detail }: SreIncidentDetailViewProps) {
  const summary = getBriefSummary(detail);
  const provider = getBriefProvider(detail);

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Incident #{detail.incident.incidentNumber}</Badge>
            <Badge variant="outline" className={cn("uppercase", severityClasses[detail.incident.severity] ?? "")}>
              {detail.incident.severity}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {formatStatus(detail.incident.status)}
            </Badge>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">{detail.incident.title}</h2>
            <p className="text-sm text-muted-foreground">
              Native SuperCheck evidence is collected from alerts, monitors, job runs, k6 runs, and stored artifacts.
            </p>
          </div>
        </div>
        <GenerateEvidenceBriefButton incidentId={detail.incident.id} hasBrief={Boolean(detail.latestBrief)} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Service</p>
          <p className="mt-2 text-lg font-semibold">{detail.incident.primaryServiceName ?? "Unmapped"}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Alerts</p>
          <p className="mt-2 text-lg font-semibold">{detail.incident.alertCount}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
          <p className="mt-2 text-lg font-semibold">{detail.evidence.length}</p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</p>
          <p className="mt-2 text-lg font-semibold">{formatDate(detail.incident.updatedAt)}</p>
        </div>
      </div>

      <Tabs defaultValue="investigation" className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-semibold">Investigation workspace</h3>
            <p className="text-sm text-muted-foreground">
              Keep AI investigation, citations, and native evidence in one incident-scoped view.
            </p>
          </div>
          <TabsList className="grid w-full grid-cols-3 lg:w-auto">
            <TabsTrigger value="investigation">AI investigation</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="brief">Brief</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="investigation" className="space-y-4">
          <SreInvestigationPanel
            incidentId={detail.incident.id}
            hasPrimaryService={Boolean(detail.incident.primaryServiceName)}
            evidenceReferences={detail.evidence.map((item) => ({
              id: item.id,
              title: item.title,
              evidenceType: item.evidenceType,
            }))}
            initialConversationId={detail.chatHistory?.conversationId ?? null}
            initialMessages={detail.chatHistory?.messages ?? []}
            chatHistories={detail.chatHistories}
          />
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <NativeEvidenceCard detail={detail} />
        </TabsContent>

        <TabsContent value="brief" className="space-y-4">
          <EvidenceBriefCard detail={detail} summary={summary} provider={provider} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  SearchCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

type SreInvestigationPanelProps = {
  incidentId: string;
  hasPrimaryService: boolean;
  serviceMappingHref: string;
  evidenceReferences?: Array<{
    id: string;
    title: string;
    evidenceType: string;
  }>;
  toolMetrics?: {
    total: number;
    errors: number;
    averageDurationMs: number;
  };
  latestInvestigation?: {
    status: "running" | "completed" | "failed" | "aborted" | "timed_out";
    summary: string | null;
    completedAt: Date | string | null;
  } | null;
};

type ReadinessItem = {
  label: string;
  description: string;
  ready: boolean;
  action?: {
    label: string;
    href: string;
  };
};

function ReadinessRow({ item }: { item: ReadinessItem }) {
  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      {item.ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{item.label}</p>
          <Badge variant="outline" className="capitalize">
            {item.ready ? "Ready" : "Needs attention"}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        {!item.ready && item.action && (
          <Button asChild variant="link" className="mt-1 h-auto p-0 text-sm">
            <Link href={item.action.href}>{item.action.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SreInvestigationPanel({
  incidentId,
  hasPrimaryService,
  serviceMappingHref,
  evidenceReferences = [],
  toolMetrics = { total: 0, errors: 0, averageDurationMs: 0 },
  latestInvestigation = null,
}: SreInvestigationPanelProps) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [useLiveConnectors, setUseLiveConnectors] = useState(false);
  const [isInvestigating, startInvestigationTransition] = useTransition();

  const readinessItems: ReadinessItem[] = [
    {
      label: "Stored evidence",
      ready: evidenceReferences.length > 0,
      description:
        evidenceReferences.length > 0
          ? `${evidenceReferences.length} evidence item${evidenceReferences.length === 1 ? "" : "s"} available for citations.`
          : "Generate a brief or collect evidence before relying on an investigation summary.",
      action:
        evidenceReferences.length > 0
          ? undefined
          : {
              label: "Generate brief",
              href: `/incidents/${incidentId}?tab=brief`,
            },
    },
    {
      label: "Service mapping",
      ready: hasPrimaryService,
      description: hasPrimaryService
        ? "Live connector tools can be scoped to the incident service."
        : "Map a primary service before using live connector tools.",
      action: hasPrimaryService
        ? undefined
        : { label: "Map service", href: serviceMappingHref },
    },
    {
      label: "Connector tools",
      ready: !useLiveConnectors || hasPrimaryService,
      description: useLiveConnectors
        ? "Connectors will run read-only with service scope and output limits."
        : "Live connectors are optional; stored evidence can still support the investigation.",
    },
  ];

  const runInvestigation = () => {
    startInvestigationTransition(async () => {
      const response = await fetch("/api/sre/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incidentId, useLiveConnectors }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        summary?: string;
      } | null;

      if (!response.ok) {
        toast.error(body?.error ?? "SRE investigation failed");
        return;
      }

      toast.success("Investigation completed", {
        description: body?.summary
          ? body.summary.slice(0, 120)
          : "Incident summary updated",
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getSreIncidentDetailQueryKey(projectId, incidentId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreIncidentsQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreEvidenceGraphQueryKey(projectId),
        }),
      ]);
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg">Investigation</CardTitle>
            <CardDescription>
              Run a read-only check from stored evidence and optional live
              connector data.
            </CardDescription>
          </div>
          <Button
            className="w-full sm:w-auto"
            onClick={runInvestigation}
            disabled={isInvestigating}
          >
            {isInvestigating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <SearchCheck className="mr-2 h-4 w-4" />
            )}
            Run investigation
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid overflow-hidden rounded-lg border sm:grid-cols-3">
          <div className="border-b px-4 py-3 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Tool calls
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {toolMetrics.total}
            </p>
          </div>
          <div className="border-b px-4 py-3 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Failures
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {toolMetrics.errors}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Avg latency
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {toolMetrics.total > 0
                ? `${toolMetrics.averageDurationMs} ms`
                : "-"}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-4">
          <Switch
            id="live-connectors"
            checked={useLiveConnectors}
            disabled={!hasPrimaryService || isInvestigating}
            onCheckedChange={setUseLiveConnectors}
          />
          <div className="space-y-1">
            <Label htmlFor="live-connectors">Use live connector tools</Label>
            <p className="text-sm text-muted-foreground">
              Optional read-only connector execution. Requires a mapped primary
              service.
            </p>
            {!hasPrimaryService && (
              <Badge variant="outline">Primary service required</Badge>
            )}
          </div>
        </div>

        <div className="rounded-lg border px-4">
          {readinessItems.map((item) => (
            <ReadinessRow key={item.label} item={item} />
          ))}
        </div>

        {latestInvestigation && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Latest result</p>
                <p className="text-xs text-muted-foreground">
                  {latestInvestigation.completedAt
                    ? `Completed ${new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(latestInvestigation.completedAt))}`
                    : "Result is not complete"}
                </p>
              </div>
              <Badge variant="outline" className="capitalize">
                {latestInvestigation.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6">
              {latestInvestigation.summary ??
                "No investigation summary was returned."}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

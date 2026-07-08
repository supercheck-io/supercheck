import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type {
  SreEvidenceGraphEdge,
  SreEvidenceGraphNode,
} from "@/lib/sre/evidence-graph-queries";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SreEvidenceGraphSidePanelProps = {
  node: SreEvidenceGraphNode | null;
  edges: SreEvidenceGraphEdge[];
  nodesById: Map<string, SreEvidenceGraphNode>;
};

function formatDate(value: Date | null) {
  if (!value) {
    return "Unknown time";
  }
  return value.toLocaleString();
}

function getDisplayNodeTitle(node: SreEvidenceGraphNode) {
  if (node.type !== "incident") {
    return node.title;
  }

  return node.title.replace(/^#\d+\s+/, "").trim() || node.title;
}

function getIncidentNumberLabel(node: SreEvidenceGraphNode) {
  if (node.type !== "incident") {
    return null;
  }

  const match = /^#(\d+)\b/.exec(node.title);
  return match ? `Incident #${match[1]}` : null;
}

function isModelLikeLabel(value: string) {
  return /\b(gpt|claude|gemini|llama|deepseek|qwen|mistral|sonnet|haiku|flash|mini)\b/i.test(
    value,
  );
}

function getDisplayNodeSubtitle(node: SreEvidenceGraphNode) {
  if (
    node.type === "investigation" &&
    node.subtitle &&
    isModelLikeLabel(node.subtitle)
  ) {
    return node.status ?? "Read-only investigation";
  }

  return node.subtitle ?? formatDate(node.createdAt);
}

function getNodeTypeColor(type: string) {
  switch (type.toLowerCase()) {
    case "job":
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300";
    case "alert":
      return "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300";
    case "service":
      return "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300";
    case "incident":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300";
    case "evidence":
      return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case "passed":
    case "past":
    case "resolved":
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "failed":
    case "critical":
    case "error":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";
    case "warning":
    case "investigating":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function SreEvidenceGraphSidePanel({
  node,
  edges,
  nodesById,
}: SreEvidenceGraphSidePanelProps) {
  if (!node) {
    return (
      <DashboardEmptyState
        title="Node details"
        description="Select a graph node to inspect source links and relationships."
        className="h-full min-h-0 bg-background"
      />
    );
  }

  const connectedEdges = edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .slice(0, 8);
  const incidentNumberLabel = getIncidentNumberLabel(node);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      <CardHeader className="shrink-0 space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`capitalize shadow-none ${getNodeTypeColor(node.type)}`}
          >
            {node.type}
          </Badge>
          {incidentNumberLabel && (
            <Badge variant="secondary">{incidentNumberLabel}</Badge>
          )}
          {node.status && (
            <Badge
              variant="outline"
              className={`capitalize shadow-none ${getStatusColor(node.status)}`}
            >
              {node.status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div>
          <CardTitle className="line-clamp-3 text-lg leading-tight">
            {getDisplayNodeTitle(node)}
          </CardTitle>
          <CardDescription className="mt-1.5" suppressHydrationWarning>
            {getDisplayNodeSubtitle(node)}
          </CardDescription>
        </div>
        {node.href && (
          <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
            <Link href={node.href}>
              View details
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Created At
          </p>
          <p className="text-sm text-foreground/90" suppressHydrationWarning>
            {formatDate(node.createdAt)}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Relationships
          </p>
          {connectedEdges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visible relationships for this node in the current graph
              window.
            </p>
          ) : (
            connectedEdges.map((edge) => {
              const otherNode = nodesById.get(
                edge.source === node.id ? edge.target : edge.source,
              );
              return (
                <div
                  key={edge.id}
                  className="rounded-lg border bg-muted/10 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{edge.label}</Badge>
                    <span className="line-clamp-1 font-medium">
                      {otherNode
                        ? getDisplayNodeTitle(otherNode)
                        : "Unknown node"}
                    </span>
                  </div>
                  {edge.evidence && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Why: {edge.evidence}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

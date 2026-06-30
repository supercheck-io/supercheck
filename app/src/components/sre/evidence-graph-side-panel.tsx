import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type { SreEvidenceGraphEdge, SreEvidenceGraphNode } from "@/lib/sre/evidence-graph-queries";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

function getNodeTypeColor(type: string) {
  switch (type.toLowerCase()) {
    case "job": return "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
    case "alert": return "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800";
    case "service": return "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800";
    case "incident": return "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "evidence": return "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800";
    default: return "bg-secondary text-secondary-foreground hover:bg-secondary/80";
  }
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case "passed":
    case "past":
    case "resolved":
    case "completed":
      return "bg-green-100 text-green-800 border-green-200 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
    case "failed":
    case "critical":
    case "error":
      return "bg-red-100 text-red-800 border-red-200 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "warning":
    case "investigating":
      return "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function SreEvidenceGraphSidePanel({ node, edges, nodesById }: SreEvidenceGraphSidePanelProps) {
  if (!node) {
    return (
      <DashboardEmptyState
        title="Node details"
        description="Select a graph node to inspect source links and relationships."
        className="min-h-[320px] bg-background xl:min-h-[calc(100svh-9rem)]"
      />
    );
  }

  const connectedEdges = edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 8);

  return (
    <Card className="min-h-[320px] rounded-xl xl:min-h-[calc(100svh-9rem)]">
      <CardHeader className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`capitalize font-medium shadow-none ${getNodeTypeColor(node.type)}`}>{node.type}</Badge>
          {node.status && <Badge variant="outline" className={`capitalize shadow-none ${getStatusColor(node.status)}`}>{node.status.replace(/_/g, " ")}</Badge>}
        </div>
        <div>
          <CardTitle className="line-clamp-3 text-lg leading-tight">{node.title}</CardTitle>
          <CardDescription className="mt-1.5" suppressHydrationWarning>{node.subtitle ?? formatDate(node.createdAt)}</CardDescription>
        </div>
        {node.href && (
          <Button asChild variant="secondary" size="sm" className="w-fit mt-1">
            <Link href={node.href}>
              View details
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Created At</p>
          <p className="text-sm text-foreground/90" suppressHydrationWarning>{formatDate(node.createdAt)}</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Relationships</p>
          {connectedEdges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visible relationships for this node in the current graph window.</p>
          ) : (
            connectedEdges.map((edge) => {
              const otherNode = nodesById.get(edge.source === node.id ? edge.target : edge.source);
              return (
                <div key={edge.id} className="rounded-2xl border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{edge.label}</Badge>
                    <span className="line-clamp-1 font-medium">{otherNode?.title ?? "Unknown node"}</span>
                  </div>
                  {edge.evidence && <p className="mt-1 text-xs text-muted-foreground">Why: {edge.evidence}</p>}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { ArrowRight, CalendarClock, ExternalLink } from "lucide-react";

import type {
  SreEvidenceGraphEdge,
  SreEvidenceGraphNode,
  SreEvidenceGraphNodeType,
} from "@/lib/sre/evidence-graph-queries";
import { isSafeEvidenceSourceUri } from "@/lib/sre/evidence-source-uri";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { cn } from "@/lib/utils";

type SreEvidenceGraphSidePanelProps = {
  node: SreEvidenceGraphNode | null;
  edge: SreEvidenceGraphEdge | null;
  edges: SreEvidenceGraphEdge[];
  nodesById: Map<string, SreEvidenceGraphNode>;
  embedded?: boolean;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string) => void;
};

function formatDate(value: Date | null) {
  if (!value) {
    return "Unknown time";
  }
  return value.toLocaleString();
}

function getDisplayNodeTitle(node: SreEvidenceGraphNode) {
  const title =
    node.type === "incident"
      ? node.title.replace(/^#\d+\s+/, "").trim()
      : node.title.trim();

  return title || `${node.type.replace(/_/g, " ")} record`;
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

function getNodeTypeTone(type: SreEvidenceGraphNodeType): TableBadgeTone {
  switch (type) {
    case "job":
      return "info";
    case "monitor":
    case "service":
      return "info";
    case "alert":
    case "recommendation":
      return "warning";
    case "incident":
      return "danger";
    case "investigation":
      return "purple";
    case "evidence":
    case "playbook":
      return "success";
    case "deployment":
      return "indigo";
    case "commit":
    case "recollection":
      return "slate";
    default:
      return "neutral";
  }
}

function getStatusTone(status: string): TableBadgeTone {
  switch (status.toLowerCase()) {
    case "passed":
    case "past":
    case "resolved":
    case "completed":
      return "success";
    case "failed":
    case "critical":
    case "error":
      return "danger";
    case "warning":
    case "investigating":
      return "warning";
    default:
      return "neutral";
  }
}

export function SreEvidenceGraphSidePanel({
  node,
  edge,
  edges,
  nodesById,
  embedded = false,
  onSelectEdge,
  onSelectNode,
}: SreEvidenceGraphSidePanelProps) {
  if (edge) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    return (
      <Card
        className={cn(
          "flex min-h-0 flex-col overflow-hidden rounded-lg",
          embedded
            ? "max-h-[calc(100svh-4rem)] rounded-none border-0 shadow-none sm:max-h-[min(76svh,40rem)]"
            : "h-full",
        )}
      >
        <CardHeader
          className={cn("shrink-0 space-y-3 pb-4", embedded && "pr-14")}
        >
          <TableBadge tone="purple" className="w-fit">
            Relationship
          </TableBadge>
          <div>
            <CardTitle className="text-lg leading-tight">
              {edge.label}
            </CardTitle>
            <CardDescription className="mt-1.5">
              Directed topology relationship and its stored provenance.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-0">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Direction
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal py-2 text-left"
              onClick={() => sourceNode && onSelectNode(sourceNode.id)}
              disabled={!sourceNode}
            >
              {sourceNode ? getDisplayNodeTitle(sourceNode) : "Unknown source"}
            </Button>
            <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              <span>{edge.label}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal py-2 text-left"
              onClick={() => targetNode && onSelectNode(targetNode.id)}
              disabled={!targetNode}
            >
              {targetNode ? getDisplayNodeTitle(targetNode) : "Unknown target"}
            </Button>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              Provenance
            </p>
            <p className="text-sm text-foreground/90">
              {edge.evidence ??
                "No provenance was recorded for this relationship."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!node) {
    return (
      <DashboardEmptyState
        title="Node details"
        description="Select a graph node to inspect source links and relationships."
        className="h-full min-h-0 bg-background"
      />
    );
  }

  const connectedEdges = edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const relationshipGroups = Array.from(
    connectedEdges.reduce<
      Map<
        string,
        {
          edge: SreEvidenceGraphEdge;
          otherNode: SreEvidenceGraphNode | undefined;
          count: number;
        }
      >
    >((groups, connectedEdge) => {
      const otherNode = nodesById.get(
        connectedEdge.source === node.id
          ? connectedEdge.target
          : connectedEdge.source,
      );
      const relatedTitle = otherNode
        ? getDisplayNodeTitle(otherNode)
        : "Unknown related record";
      const groupKey = [
        connectedEdge.label,
        otherNode?.type ?? "unknown",
        relatedTitle.toLowerCase(),
      ].join(":");
      const existing = groups.get(groupKey);

      if (existing) {
        existing.count += 1;
      } else {
        groups.set(groupKey, { edge: connectedEdge, otherNode, count: 1 });
      }

      return groups;
    }, new Map()),
  ).map(([, group]) => group);
  const visibleRelationshipGroups = relationshipGroups.slice(0, 6);
  const hiddenRelationshipGroups = Math.max(
    relationshipGroups.length - visibleRelationshipGroups.length,
    0,
  );
  const incidentNumberLabel = getIncidentNumberLabel(node);
  const safeNodeHref =
    node.href && isSafeEvidenceSourceUri(node.href) ? node.href : null;

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg",
        embedded
          ? "max-h-[calc(100svh-4rem)] rounded-none border-0 shadow-none sm:max-h-[min(76svh,40rem)]"
          : "h-full",
      )}
    >
      <CardHeader
        className={cn("shrink-0 space-y-3 pb-4", embedded && "pr-14")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <TableBadge tone={getNodeTypeTone(node.type)} className="capitalize">
            {node.type}
          </TableBadge>
          {incidentNumberLabel && (
            <TableBadge tone="danger" className="font-semibold">
              {incidentNumberLabel}
            </TableBadge>
          )}
          {node.status && (
            <TableBadge
              tone={getStatusTone(node.status)}
              className="capitalize"
            >
              {node.status.replace(/_/g, " ")}
            </TableBadge>
          )}
        </div>
        <div>
          <CardTitle
            className="line-clamp-2 text-xl leading-snug"
            title={getDisplayNodeTitle(node)}
          >
            {getDisplayNodeTitle(node)}
          </CardTitle>
          <CardDescription className="mt-1.5" suppressHydrationWarning>
            {getDisplayNodeSubtitle(node)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {safeNodeHref ? (
            <Button asChild variant="outline" size="sm" className="w-fit">
              {safeNodeHref.startsWith("http://") ||
              safeNodeHref.startsWith("https://") ? (
                <a
                  href={safeNodeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View details
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              ) : (
                <Link href={safeNodeHref}>
                  View details
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              )}
            </Button>
          ) : (
            <span />
          )}
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            suppressHydrationWarning
          >
            <CalendarClock className="h-3.5 w-3.5" />
            <span>{formatDate(node.createdAt)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-0 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Relationships
            </p>
            <TableBadge tone="slate" compact>
              {connectedEdges.length}
            </TableBadge>
          </div>
          {visibleRelationshipGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visible relationships for this node in the current graph
              window.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border bg-background/40">
              <div className="divide-y">
                {visibleRelationshipGroups.map(({ edge, otherNode, count }) => {
                  const relatedTitle = otherNode
                    ? getDisplayNodeTitle(otherNode)
                    : "Unknown related record";
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      className="group flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => onSelectEdge(edge.id)}
                      aria-label={`${relatedTitle} ${edge.label}`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          {otherNode && (
                            <TableBadge
                              tone={getNodeTypeTone(otherNode.type)}
                              compact
                              className="capitalize"
                            >
                              {otherNode.type}
                            </TableBadge>
                          )}
                          <span className="min-w-0 truncate text-sm font-medium">
                            {relatedTitle}
                          </span>
                          {count > 1 && (
                            <TableBadge tone="neutral" compact>
                              {count} similar
                            </TableBadge>
                          )}
                        </div>
                        <span className="block truncate text-xs capitalize text-muted-foreground">
                          {edge.label}
                        </span>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </button>
                  );
                })}
              </div>
              {hiddenRelationshipGroups > 0 && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {hiddenRelationshipGroups} more relationship groups are
                  available from the source details.
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

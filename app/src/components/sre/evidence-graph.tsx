"use client";

import { useMemo, useState } from "react";
import { Network, Search, Maximize2, Minimize2 } from "lucide-react";

import { SreEvidenceGraphSidePanel } from "@/components/sre/evidence-graph-side-panel";
import type { SreEvidenceGraph as SreEvidenceGraphData, SreEvidenceGraphNode, SreEvidenceGraphNodeType } from "@/lib/sre/evidence-graph-queries";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SreEvidenceGraphProps = {
  graph: SreEvidenceGraphData;
  loadError?: string | null;
};

const NODE_TYPES: Array<{ value: SreEvidenceGraphNodeType | "all"; label: string }> = [
  { value: "all", label: "All node types" },
  { value: "service", label: "Services" },
  { value: "monitor", label: "Monitors" },
  { value: "job", label: "Jobs" },
  { value: "alert", label: "Alerts" },
  { value: "incident", label: "Incidents" },
  { value: "investigation", label: "Investigations" },
  { value: "evidence", label: "Evidence" },
  { value: "recommendation", label: "Recommendations" },
  { value: "deployment", label: "Deployments" },
  { value: "commit", label: "Commits" },
  { value: "recollection", label: "Recollections" },
  { value: "playbook", label: "Playbooks" },
];

const NODE_TYPE_LABELS: Record<SreEvidenceGraphNodeType, string> = {
  service: "Services",
  monitor: "Monitors",
  job: "Jobs",
  alert: "Alerts",
  incident: "Incidents",
  investigation: "Investigations",
  evidence: "Evidence",
  recommendation: "Recommendations",
  deployment: "Deployments",
  commit: "Commits",
  recollection: "Recollections",
  playbook: "Playbooks",
};

const NODE_TYPE_CLASSES: Record<SreEvidenceGraphNodeType, string> = {
  service: "border-sky-500/30 bg-sky-500/10",
  monitor: "border-cyan-500/30 bg-cyan-500/10",
  job: "border-indigo-500/30 bg-indigo-500/10",
  alert: "border-red-500/30 bg-red-500/10",
  incident: "border-rose-500/30 bg-rose-500/10",
  investigation: "border-violet-500/30 bg-violet-500/10",
  evidence: "border-emerald-500/30 bg-emerald-500/10",
  recommendation: "border-amber-500/30 bg-amber-500/10",
  deployment: "border-blue-500/30 bg-blue-500/10",
  commit: "border-slate-500/30 bg-slate-500/10",
  recollection: "border-teal-500/30 bg-teal-500/10",
  playbook: "border-lime-500/30 bg-lime-500/10",
};

function nodeMatchesQuery(node: SreEvidenceGraphNode, query: string) {
  if (!query) {
    return true;
  }

  return [node.title, node.subtitle, node.status, node.type].filter(Boolean).join(" ").toLowerCase().includes(query);
}

function getIncidentNeighborhoodNodeIds(incidentNodeId: string, edges: SreEvidenceGraphData["edges"]) {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    adjacency.set(edge.source, (adjacency.get(edge.source) ?? new Set()).add(edge.target));
    adjacency.set(edge.target, (adjacency.get(edge.target) ?? new Set()).add(edge.source));
  }

  const visited = new Set<string>([incidentNodeId]);
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: incidentNodeId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= 2) {
      continue;
    }

    for (const nextNodeId of adjacency.get(current.nodeId) ?? []) {
      if (visited.has(nextNodeId)) {
        continue;
      }

      visited.add(nextNodeId);
      queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
    }
  }

  return visited;
}

export function SreEvidenceGraph({
  graph,
  loadError = null,
}: SreEvidenceGraphProps) {
  const [query, setQuery] = useState("");
  const [nodeType, setNodeType] = useState<SreEvidenceGraphNodeType | "all">("all");
  const [incidentFocusId, setIncidentFocusId] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [isMaximized, setIsMaximized] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const incidentOptions = useMemo(
    () => graph.nodes.filter((node) => node.type === "incident").slice(0, 25),
    [graph.nodes]
  );
  const focusedNodeIds = useMemo(
    () => (incidentFocusId === "all" ? null : getIncidentNeighborhoodNodeIds(incidentFocusId, graph.edges)),
    [graph.edges, incidentFocusId]
  );
  const visibleNodes = useMemo(
    () =>
      graph.nodes.filter(
        (node) =>
          (!focusedNodeIds || focusedNodeIds.has(node.id)) &&
          (nodeType === "all" || node.type === nodeType) &&
          nodeMatchesQuery(node, normalizedQuery)
      ),
    [focusedNodeIds, graph.nodes, nodeType, normalizedQuery]
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const effectiveSelectedNodeId = selectedNodeId && visibleNodeIds.has(selectedNodeId) ? selectedNodeId : visibleNodes[0]?.id ?? null;
  const selectedNode = effectiveSelectedNodeId ? nodesById.get(effectiveSelectedNodeId) ?? null : null;
  const focusedIncident = incidentFocusId === "all" ? null : graph.nodes.find((node) => node.id === incidentFocusId) ?? null;
  const hasActiveFilters = Boolean(normalizedQuery) || nodeType !== "all" || incidentFocusId !== "all";
  const groupedNodes = NODE_TYPES.filter((type) => type.value !== "all").map((type) => ({
    type: type.value as SreEvidenceGraphNodeType,
    nodes: visibleNodes.filter((node) => node.type === type.value).slice(0, 8),
    total: visibleNodes.filter((node) => node.type === type.value).length,
  }));
  const displayedGroups = groupedNodes.filter((group) => group.total > 0 || (nodeType !== "all" && group.type === nodeType));
  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>SRE evidence graph unavailable</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="flex min-h-[520px] flex-col overflow-hidden rounded-xl xl:min-h-[calc(100svh-9rem)]">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
            <div className="flex-1">
              <CardTitle className="text-2xl font-semibold">
                Evidence graph
              </CardTitle>
              <CardDescription>Find relationships between services, alerts, incidents, evidence, and recommendations.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary" className="rounded-full">{visibleNodes.length} visible</Badge>
              <Badge variant="outline" className="rounded-full">{graph.nodes.length} total nodes</Badge>
              <Badge variant="outline" className="rounded-full">{visibleEdges.length} relationships</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_220px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search graph nodes..." className="pl-9" />
            </div>
            <Select value={nodeType} onValueChange={(value) => setNodeType(value as SreEvidenceGraphNodeType | "all")}>
              <SelectTrigger><SelectValue placeholder="Node type" /></SelectTrigger>
              <SelectContent>
                {NODE_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={incidentFocusId} onValueChange={setIncidentFocusId}>
              <SelectTrigger><SelectValue placeholder="Incident focus" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All incidents</SelectItem>
                {incidentOptions.map((incident) => (
                  <SelectItem key={incident.id} value={incident.id}>{incident.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                setNodeType("all");
                setIncidentFocusId("all");
              }}
              disabled={!hasActiveFilters}
            >
              Clear
            </Button>
          </div>

          {focusedIncident && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/10 px-3 py-2">
              <p className="text-sm text-muted-foreground">
                Focused on <span className="font-medium text-foreground">{focusedIncident.title}</span>
              </p>
              <Badge variant="outline" className="rounded-full">{visibleNodes.length} nodes</Badge>
            </div>
          )}

          <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background transition-all duration-300", isMaximized && "fixed inset-4 z-50 shadow-2xl")}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Operational lanes</p>
                <p className="text-xs text-muted-foreground">Select a node to inspect source, status, and relationships.</p>
              </div>
              <div className="flex items-center gap-2">
                {visibleEdges.length === 0 && visibleNodes.length > 0 && (
                  <Badge variant="outline" className="rounded-full">No visible relationships</Badge>
                )}
                <Button variant="ghost" size="icon" onClick={() => setIsMaximized(!isMaximized)} aria-label="Toggle maximize operational lanes">
                  {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle,rgba(0,0,0,0.1)_1px,transparent_1px)] dark:bg-[radial-gradient(circle,rgba(255,255,255,0.1)_1px,transparent_1px)] [background-size:16px_16px]"
              aria-label="Evidence graph viewport"
              tabIndex={0}
            >
              <div
                className="grid min-h-full grid-flow-col auto-cols-[minmax(280px,340px)] gap-px bg-border/20"
              >
                {displayedGroups.length === 0 ? (
                  <div className="flex w-full min-w-[600px] items-center justify-center p-8">
                    <DashboardEmptyState
                      icon={<Network className="h-10 w-10 text-muted-foreground" />}
                      title="No nodes match the current filters"
                      description="Adjust or clear filters to see more relationships in the evidence graph."
                      className="min-h-[400px]"
                    />
                  </div>
                ) : (
                  displayedGroups.map((group) => (
                    <div key={group.type} className="p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <Label className="text-sm font-semibold">{NODE_TYPE_LABELS[group.type]}</Label>
                        <Badge variant="outline" className="rounded-full">{group.total}</Badge>
                      </div>
                      <div className="space-y-2">
                        {group.nodes.length === 0 ? (
                          <div className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">No visible nodes</div>
                        ) : (
                          group.nodes.map((node) => (
                            <button
                              key={node.id}
                              type="button"
                              aria-label={`Select ${node.type} node ${node.title}`}
                              onClick={() => setSelectedNodeId(node.id)}
                              className={cn(
                                "w-full rounded-xl border p-3 text-left text-sm transition-colors hover:bg-background",
                                NODE_TYPE_CLASSES[node.type],
                                effectiveSelectedNodeId === node.id && "ring-2 ring-ring"
                              )}
                            >
                              <span className="line-clamp-2 font-medium">{node.title}</span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">{node.subtitle ?? node.status ?? "No detail"}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {visibleEdges.length > 0 && (
            <div className="rounded-2xl border bg-muted/10 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Relationship paths</h3>
                <Badge variant="outline" className="rounded-full">{visibleEdges.length} visible edges</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {visibleEdges.slice(0, 12).map((edge) => {
                  const source = nodesById.get(edge.source);
                  const target = nodesById.get(edge.target);
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      aria-label={`Inspect relationship ${source?.title ?? "Unknown"} ${edge.label} ${target?.title ?? "Unknown"}`}
                      onClick={() => setSelectedNodeId(edge.target)}
                      className="rounded-2xl border bg-background p-3 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="line-clamp-1 font-medium">{source?.title ?? "Unknown"}</span>
                      <span className="my-1 block text-xs text-muted-foreground">{edge.label}</span>
                      <span className="line-clamp-1 font-medium">{target?.title ?? "Unknown"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SreEvidenceGraphSidePanel node={selectedNode} edges={graph.edges} nodesById={nodesById} />
    </div>
  );
}

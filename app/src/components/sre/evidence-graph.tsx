"use client";

import { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";

import { SreEvidenceGraphSidePanel } from "@/components/sre/evidence-graph-side-panel";
import type { SreEvidenceGraph as SreEvidenceGraphData, SreEvidenceGraphNode, SreEvidenceGraphNodeType } from "@/lib/sre/evidence-graph-queries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SreEvidenceGraphProps = {
  graph: SreEvidenceGraphData;
  loadError?: string | null;
};

const NODE_TYPES: Array<{ value: SreEvidenceGraphNodeType | "all"; label: string }> = [
  { value: "all", label: "All node types" },
  { value: "service", label: "Services" },
  { value: "incident", label: "Incidents" },
  { value: "investigation", label: "Investigations" },
  { value: "evidence", label: "Evidence" },
  { value: "recommendation", label: "Recommendations" },
];

const NODE_TYPE_LABELS: Record<SreEvidenceGraphNodeType, string> = {
  service: "Services",
  incident: "Incidents",
  investigation: "Investigations",
  evidence: "Evidence",
  recommendation: "Recommendations",
};

const NODE_TYPE_CLASSES: Record<SreEvidenceGraphNodeType, string> = {
  service: "border-sky-500/30 bg-sky-500/10",
  incident: "border-rose-500/30 bg-rose-500/10",
  investigation: "border-violet-500/30 bg-violet-500/10",
  evidence: "border-emerald-500/30 bg-emerald-500/10",
  recommendation: "border-amber-500/30 bg-amber-500/10",
};

function nodeMatchesQuery(node: SreEvidenceGraphNode, query: string) {
  if (!query) {
    return true;
  }

  return [node.title, node.subtitle, node.status, node.type].filter(Boolean).join(" ").toLowerCase().includes(query);
}

export function SreEvidenceGraph({ graph, loadError = null }: SreEvidenceGraphProps) {
  const [query, setQuery] = useState("");
  const [nodeType, setNodeType] = useState<SreEvidenceGraphNodeType | "all">("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id ?? null);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodes = useMemo(
    () => graph.nodes.filter((node) => (nodeType === "all" || node.type === nodeType) && nodeMatchesQuery(node, normalizedQuery)),
    [graph.nodes, nodeType, normalizedQuery]
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const effectiveSelectedNodeId = selectedNodeId && visibleNodeIds.has(selectedNodeId) ? selectedNodeId : visibleNodes[0]?.id ?? null;
  const selectedNode = effectiveSelectedNodeId ? nodesById.get(effectiveSelectedNodeId) ?? null : null;
  const hasActiveFilters = Boolean(normalizedQuery) || nodeType !== "all";
  const groupedNodes = NODE_TYPES.filter((type) => type.value !== "all").map((type) => ({
    type: type.value as SreEvidenceGraphNodeType,
    nodes: visibleNodes.filter((node) => node.type === type.value).slice(0, 8),
    total: visibleNodes.filter((node) => node.type === type.value).length,
  }));

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>SRE evidence graph unavailable</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden rounded-3xl">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Network className="h-5 w-5" />
                Evidence graph
              </CardTitle>
              <CardDescription>Cross-incident links between services, incidents, investigations, evidence, and recommended fix steps.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {NODE_TYPES.filter((type) => type.value !== "all").map((type) => (
                <Badge key={type.value} variant="secondary" className="rounded-full">
                  {type.label}: {graph.stats[type.value as SreEvidenceGraphNodeType]}
                </Badge>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
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
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                setNodeType("all");
              }}
              disabled={!hasActiveFilters}
            >
              Clear
            </Button>
          </div>

          <div className="overflow-hidden rounded-3xl border bg-background">
            <div className="grid min-h-[520px] gap-px bg-border lg:grid-cols-5">
              {groupedNodes.map((group) => (
                <div key={group.type} className="bg-muted/10 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{NODE_TYPE_LABELS[group.type]}</h3>
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
                            "w-full rounded-2xl border p-3 text-left text-sm transition-colors hover:bg-background",
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
              ))}
            </div>
          </div>

          <div className="rounded-3xl border bg-muted/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Relationship paths</h3>
              <Badge variant="outline" className="rounded-full">{visibleEdges.length} visible edges</Badge>
            </div>
            {visibleEdges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No relationships match the current filters.</p>
            ) : (
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
            )}
          </div>
        </CardContent>
      </Card>

      <SreEvidenceGraphSidePanel node={selectedNode} edges={graph.edges} nodesById={nodesById} />
    </div>
  );
}

"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  BellRing,
  Boxes,
  BrainCircuit,
  GitCommitHorizontal,
  Lightbulb,
  Maximize2,
  Network,
  Play,
  Rocket,
  Search,
  Server,
  Siren,
  Wrench,
  X,
} from "lucide-react";
import { type ComponentType, useMemo, useState } from "react";

import { SreEvidenceGraphSidePanel } from "@/components/sre/evidence-graph-side-panel";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TableBadge } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  SreEvidenceGraph as SreEvidenceGraphData,
  SreEvidenceGraphEdge,
  SreEvidenceGraphNode,
  SreEvidenceGraphNodeType,
} from "@/lib/sre/evidence-graph-queries";
import { cn } from "@/lib/utils";

type SreEvidenceGraphProps = {
  graph: SreEvidenceGraphData;
  loadError?: string | null;
  initialSelectedNodeId?: string | null;
};

type TopologyNodeData = {
  graphNode: SreEvidenceGraphNode;
  isConnected: boolean;
  isDimmed: boolean;
} & Record<string, unknown>;

type TopologyNode = Node<TopologyNodeData, "topology">;
type TopologyView =
  | "essentials"
  | "services-incidents"
  | "changes"
  | "investigations"
  | "all";

const NODE_WIDTH = 228;
const NODE_HEIGHT = 84;
const MAX_CANVAS_NODES = 160;

const TOPOLOGY_VIEWS: Array<{
  value: TopologyView;
  label: string;
  nodeTypes: ReadonlySet<SreEvidenceGraphNodeType> | null;
}> = [
  {
    value: "essentials",
    label: "Essentials",
    nodeTypes: new Set([
      "service",
      "alert",
      "incident",
      "investigation",
      "deployment",
      "playbook",
    ]),
  },
  {
    value: "services-incidents",
    label: "Services & incidents",
    nodeTypes: new Set(["service", "monitor", "job", "alert", "incident"]),
  },
  {
    value: "changes",
    label: "Changes",
    nodeTypes: new Set(["service", "incident", "deployment", "commit"]),
  },
  {
    value: "investigations",
    label: "Investigations",
    nodeTypes: new Set([
      "incident",
      "investigation",
      "evidence",
      "recommendation",
      "playbook",
    ]),
  },
  { value: "all", label: "All details", nodeTypes: null },
];

const NODE_TYPE_META: Record<
  SreEvidenceGraphNodeType,
  { icon: ComponentType<{ className?: string }>; label: string; color: string }
> = {
  service: { icon: Boxes, label: "Service", color: "#2563eb" },
  monitor: { icon: Activity, label: "Monitor", color: "#0891b2" },
  job: { icon: Play, label: "Job", color: "#0d9488" },
  alert: { icon: BellRing, label: "Alert", color: "#ea580c" },
  incident: { icon: Siren, label: "Incident", color: "#e11d48" },
  investigation: {
    icon: BrainCircuit,
    label: "Investigation",
    color: "#7c3aed",
  },
  evidence: { icon: Search, label: "Evidence", color: "#0f766e" },
  recommendation: {
    icon: Lightbulb,
    label: "Recommendation",
    color: "#ca8a04",
  },
  deployment: { icon: Rocket, label: "Deployment", color: "#4f46e5" },
  commit: { icon: GitCommitHorizontal, label: "Commit", color: "#475569" },
  recollection: { icon: Server, label: "Recollection", color: "#64748b" },
  playbook: { icon: Wrench, label: "Playbook", color: "#15803d" },
};

function isModelLikeLabel(value: string) {
  return /\b(gpt|claude|gemini|llama|deepseek|qwen|mistral|sonnet|haiku|flash|mini)\b/i.test(
    value,
  );
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
  return match ? `#${match[1]}` : null;
}

function getDisplayNodeSubtitle(node: SreEvidenceGraphNode) {
  if (
    node.type === "investigation" &&
    node.subtitle &&
    isModelLikeLabel(node.subtitle)
  ) {
    return node.status ?? "Read-only investigation";
  }

  return node.subtitle ?? node.status ?? "No detail";
}

function nodeMatchesQuery(node: SreEvidenceGraphNode, query: string) {
  if (!query) {
    return true;
  }

  return [node.title, node.subtitle, node.status, node.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getIncidentNeighborhoodNodeIds(
  incidentNodeId: string,
  edges: SreEvidenceGraphData["edges"],
) {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    adjacency.set(
      edge.source,
      (adjacency.get(edge.source) ?? new Set()).add(edge.target),
    );
    adjacency.set(
      edge.target,
      (adjacency.get(edge.target) ?? new Set()).add(edge.source),
    );
  }

  const visited = new Set<string>([incidentNodeId]);
  const queue: Array<{ nodeId: string; depth: number }> = [
    { nodeId: incidentNodeId, depth: 0 },
  ];

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

function TopologyNodeCard({ data, selected }: NodeProps<TopologyNode>) {
  const node = data.graphNode;
  const meta = NODE_TYPE_META[node.type];
  const Icon = meta.icon;
  const incidentNumberLabel = getIncidentNumberLabel(node);

  return (
    <div
      className={cn(
        "h-[84px] w-[228px] rounded-md border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-opacity",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        data.isConnected && !selected && "border-foreground/40",
        data.isDimmed && "opacity-35",
      )}
      style={{ borderLeftColor: meta.color, borderLeftWidth: 4 }}
      aria-label={`${meta.label}: ${getDisplayNodeTitle(node)}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-muted-foreground/60"
      />
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-[11px] font-medium uppercase text-muted-foreground">
          {meta.label}
        </span>
        {incidentNumberLabel && (
          <TableBadge
            tone="danger"
            compact
            className="ml-auto h-5 px-1.5 text-[10px] font-semibold"
          >
            {incidentNumberLabel}
          </TableBadge>
        )}
      </div>
      <p className="mt-1 line-clamp-1 text-sm font-medium">
        {getDisplayNodeTitle(node)}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {getDisplayNodeSubtitle(node)}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-muted-foreground/60"
      />
    </div>
  );
}

const topologyNodeTypes = { topology: TopologyNodeCard };

function buildTopology(
  graphNodes: SreEvidenceGraphNode[],
  graphEdges: SreEvidenceGraphEdge[],
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
) {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  layout.setGraph({
    rankdir: "LR",
    align: "UL",
    nodesep: 34,
    ranksep: 88,
    marginx: 28,
    marginy: 28,
  });

  for (const node of graphNodes) {
    layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graphEdges) {
    layout.setEdge(edge.source, edge.target);
  }
  dagre.layout(layout);

  const selectedEdge = graphEdges.find((edge) => edge.id === selectedEdgeId);
  const connectedNodeIds = new Set<string>();
  if (selectedNodeId) {
    connectedNodeIds.add(selectedNodeId);
    for (const edge of graphEdges) {
      if (edge.source === selectedNodeId) connectedNodeIds.add(edge.target);
      if (edge.target === selectedNodeId) connectedNodeIds.add(edge.source);
    }
  } else if (selectedEdge) {
    connectedNodeIds.add(selectedEdge.source);
    connectedNodeIds.add(selectedEdge.target);
  }

  const nodes: TopologyNode[] = graphNodes.map((graphNode) => {
    const position = layout.node(graphNode.id);
    const isConnected = connectedNodeIds.has(graphNode.id);
    return {
      id: graphNode.id,
      type: "topology",
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
      data: {
        graphNode,
        isConnected,
        isDimmed: connectedNodeIds.size > 0 && !isConnected,
      },
      selected: graphNode.id === selectedNodeId,
      draggable: true,
      connectable: false,
    };
  });

  const edges: Edge[] = graphEdges.map((edge) => {
    const isConnected = selectedNodeId
      ? edge.source === selectedNodeId || edge.target === selectedNodeId
      : edge.id === selectedEdgeId;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: {
        strokeWidth: isConnected ? 2.5 : 1.25,
        opacity:
          selectedNodeId || selectedEdgeId ? (isConnected ? 1 : 0.18) : 0.7,
      },
      labelStyle: { fontSize: 11, fill: "var(--muted-foreground)" },
      labelBgStyle: {
        fill: "var(--background)",
        fillOpacity: 0.96,
      },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 3,
    };
  });

  return { nodes, edges };
}

type TopologyViewportProps = {
  graphNodes: SreEvidenceGraphNode[];
  graphEdges: SreEvidenceGraphEdge[];
  isExpanded?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  titleId: string;
};

function TopologyViewport({
  graphNodes,
  graphEdges,
  isExpanded = false,
  onClose,
  onExpand,
  onSelectEdge,
  onSelectNode,
  selectedEdgeId,
  selectedNodeId,
  titleId,
}: TopologyViewportProps) {
  const topology = useMemo(
    () => buildTopology(graphNodes, graphEdges, selectedNodeId, selectedEdgeId),
    [graphEdges, graphNodes, selectedEdgeId, selectedNodeId],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        isExpanded ? "h-full" : "min-h-[420px] flex-1 rounded-md border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <p id={titleId} className="text-sm font-medium">
            Investigation context
          </p>
          <p className="text-xs text-muted-foreground">
            Select a node or relationship to isolate its causal context.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TableBadge tone="slate" compact>
            {graphEdges.length} relationships
          </TableBadge>
          {isExpanded ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close expanded Investigation Map"
              title="Close expanded Investigation Map"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={onExpand}
              aria-label="Expand Investigation Map"
              title="Expand Investigation Map"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1"
        aria-label="Investigation Map canvas"
      >
        {graphNodes.length === 0 ? (
          <DashboardEmptyState
            icon={<Network className="h-10 w-10 text-muted-foreground" />}
            title="No nodes match the current filters"
            description="Adjust or clear filters to see topology relationships."
            className="h-full min-h-[360px]"
          />
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={topology.nodes}
              edges={topology.edges}
              nodeTypes={topologyNodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }}
              minZoom={0.2}
              maxZoom={1.8}
              nodesConnectable={false}
              nodesDraggable={false}
              elementsSelectable
              onNodeClick={(_, node) => onSelectNode(node.id)}
              onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
              proOptions={{ hideAttribution: true }}
              className="sre-investigation-map"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1}
              />
              {isExpanded && (
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(node) =>
                    NODE_TYPE_META[
                      (node.data as TopologyNodeData).graphNode.type
                    ].color
                  }
                  className="!hidden !border !border-border !bg-background lg:!block"
                />
              )}
              <Controls
                position="bottom-left"
                showInteractive={false}
                aria-label="Topology zoom and fit controls"
                className="!overflow-hidden !rounded-md !border !border-border !bg-background !shadow-sm [&_button]:!border-border [&_button]:!bg-background [&_button]:!text-foreground [&_button:hover]:!bg-muted"
              />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

export function SreEvidenceGraph({
  graph,
  loadError = null,
  initialSelectedNodeId = null,
}: SreEvidenceGraphProps) {
  const [query, setQuery] = useState("");
  const [topologyView, setTopologyView] =
    useState<TopologyView>("essentials");
  const [incidentFocusId, setIncidentFocusId] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialSelectedNodeId,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const incidentOptions = useMemo(
    () => graph.nodes.filter((node) => node.type === "incident").slice(0, 25),
    [graph.nodes],
  );
  const focusedNodeIds = useMemo(
    () =>
      incidentFocusId === "all"
        ? null
        : getIncidentNeighborhoodNodeIds(incidentFocusId, graph.edges),
    [graph.edges, incidentFocusId],
  );
  const activeViewNodeTypes = useMemo(
    () =>
      TOPOLOGY_VIEWS.find((view) => view.value === topologyView)?.nodeTypes ??
      null,
    [topologyView],
  );
  const matchingNodes = useMemo(
    () =>
      graph.nodes.filter(
        (node) =>
          (!focusedNodeIds || focusedNodeIds.has(node.id)) &&
          (Boolean(normalizedQuery) ||
            !activeViewNodeTypes ||
            activeViewNodeTypes.has(node.type)) &&
          nodeMatchesQuery(node, normalizedQuery),
      ),
    [
      activeViewNodeTypes,
      focusedNodeIds,
      graph.nodes,
      normalizedQuery,
    ],
  );
  const visibleNodes = matchingNodes.slice(0, MAX_CANVAS_NODES);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const effectiveSelectedEdgeId =
    selectedEdgeId && visibleEdges.some((edge) => edge.id === selectedEdgeId)
      ? selectedEdgeId
      : null;
  const effectiveSelectedNodeId =
    !effectiveSelectedEdgeId &&
    selectedNodeId &&
    visibleNodeIds.has(selectedNodeId)
      ? selectedNodeId
      : null;
  const selectedNode = effectiveSelectedNodeId
    ? (nodesById.get(effectiveSelectedNodeId) ?? null)
    : null;
  const selectedEdge = effectiveSelectedEdgeId
    ? (visibleEdges.find((edge) => edge.id === effectiveSelectedEdgeId) ?? null)
    : null;
  const focusedIncident =
    incidentFocusId === "all"
      ? null
      : (graph.nodes.find((node) => node.id === incidentFocusId) ?? null);
  const hasActiveFilters =
    Boolean(normalizedQuery) ||
    topologyView !== "essentials" ||
    incidentFocusId !== "all";
  const isTruncated = matchingNodes.length > visibleNodes.length;

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Investigation Map unavailable</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  };
  const selectEdge = (edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <CardTitle className="text-2xl font-semibold">
                Investigation Map
              </CardTitle>
              <CardDescription>
                Follow the shortest useful path from service health to alert,
                incident, investigation, and change context.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <TableBadge tone="info">{visibleNodes.length} visible</TableBadge>
              {isTruncated && (
                <TableBadge tone="warning">
                  {matchingNodes.length - visibleNodes.length} hidden by limit
                </TableBadge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-5">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_190px_minmax(0,220px)_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search topology..."
                className="pl-9"
              />
            </div>
            <Select
              value={topologyView}
              onValueChange={(value) => {
                setTopologyView(value as TopologyView);
                setSelectedEdgeId(null);
              }}
            >
              <SelectTrigger aria-label="Map view">
                <SelectValue placeholder="Map view" />
              </SelectTrigger>
              <SelectContent>
                {TOPOLOGY_VIEWS.map((view) => (
                  <SelectItem key={view.value} value={view.value}>
                    {view.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={incidentFocusId}
              onValueChange={(value) => {
                setIncidentFocusId(value);
                setSelectedEdgeId(null);
              }}
            >
              <SelectTrigger
                aria-label="Incident focus"
                className="min-w-0 max-w-full [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
              >
                <SelectValue placeholder="Incident focus" />
              </SelectTrigger>
              <SelectContent className="max-w-[min(30rem,calc(100vw-2rem))]">
                <SelectItem value="all">All incidents</SelectItem>
                {incidentOptions.map((incident) => (
                  <SelectItem key={incident.id} value={incident.id}>
                    <span className="block max-w-[26rem] truncate">
                      {incident.title}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                setTopologyView("essentials");
                setIncidentFocusId("all");
                setSelectedEdgeId(null);
              }}
              disabled={!hasActiveFilters}
            >
              Clear
            </Button>
          </div>

          {focusedIncident && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-sm text-muted-foreground">
                Incident overlay: {" "}
                <span className="font-medium text-foreground">
                  {focusedIncident.title}
                </span>
              </p>
              <TableBadge tone="purple">Two-hop causal neighborhood</TableBadge>
            </div>
          )}

          <TopologyViewport
            graphNodes={visibleNodes}
            graphEdges={visibleEdges}
            onExpand={() => setIsMaximized(true)}
            onSelectEdge={selectEdge}
            onSelectNode={selectNode}
            selectedEdgeId={effectiveSelectedEdgeId}
            selectedNodeId={effectiveSelectedNodeId}
            titleId="evidence-topology-title"
          />
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedNode || selectedEdge)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100svh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(86svh,48rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-lg lg:w-auto lg:min-w-[48rem] xl:min-w-[56rem] xl:max-w-[56rem]">
          <DialogTitle className="sr-only">
            {selectedEdge
              ? `Relationship: ${selectedEdge.label}`
              : selectedNode
                ? `${NODE_TYPE_META[selectedNode.type].label}: ${getDisplayNodeTitle(selectedNode)}`
                : "Investigation Map details"}
          </DialogTitle>
          <div className="min-h-0 overflow-hidden">
            <SreEvidenceGraphSidePanel
              node={selectedNode}
              edge={selectedEdge}
              edges={graph.edges}
              nodesById={nodesById}
              embedded
              onSelectEdge={selectEdge}
              onSelectNode={selectNode}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        <DialogContent
          hideClose
          className="h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] gap-0 rounded-none p-0 sm:h-[calc(100%-4rem)] sm:max-w-[calc(100%-4rem)] sm:rounded-lg"
        >
          <DialogTitle className="sr-only">
            Expanded Investigation Map
          </DialogTitle>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TopologyViewport
              graphNodes={visibleNodes}
              graphEdges={visibleEdges}
              isExpanded
              onClose={() => setIsMaximized(false)}
              onSelectEdge={selectEdge}
              onSelectNode={selectNode}
              selectedEdgeId={effectiveSelectedEdgeId}
              selectedNodeId={effectiveSelectedNodeId}
              titleId="expanded-evidence-topology-title"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

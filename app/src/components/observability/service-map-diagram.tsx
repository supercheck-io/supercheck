/**
 * ServiceMapDiagram
 * Interactive service topology visualization (Datadog-style)
 * Displays services as nodes and dependencies as edges
 */

"use client";

import React, { useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import type { ServiceNode, ServiceEdge } from "~/types/observability";
import { Activity, AlertCircle, Zap } from "lucide-react";
import { cn } from "~/lib/utils";

interface ServiceMapDiagramProps {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  isLoading?: boolean;
  onServiceClick?: (serviceName: string) => void;
}

interface Position {
  x: number;
  y: number;
}

interface LayoutNode extends ServiceNode {
  position: Position;
}

interface LayoutEdge extends ServiceEdge {
  sourcePos: Position;
  targetPos: Position;
}

/**
 * Simple force-directed layout algorithm for service nodes
 */
function calculateLayout(
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  width: number = 800,
  height: number = 600
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const padding = 80;
  const centerX = width / 2;
  const centerY = height / 2;

  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Initialize positions in a circle
  const positions: Map<string, Position> = new Map();
  const radius = Math.min(width, height) / 3;

  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    positions.set(node.serviceName, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  // Simple repulsion forces (prevent overlap)
  const iterations = 50;
  const repulsionForce = 150;
  const attractionForce = 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Map<string, { x: number; y: number }> = new Map();

    // Initialize forces
    nodes.forEach((node) => {
      forces.set(node.serviceName, { x: 0, y: 0 });
    });

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pos1 = positions.get(nodes[i].serviceName)!;
        const pos2 = positions.get(nodes[j].serviceName)!;

        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = repulsionForce / (distance * distance);

        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        const f1 = forces.get(nodes[i].serviceName)!;
        const f2 = forces.get(nodes[j].serviceName)!;

        f1.x -= normalizedDx * force;
        f1.y -= normalizedDy * force;
        f2.x += normalizedDx * force;
        f2.y += normalizedDy * force;
      }
    }

    // Attraction along edges
    edges.forEach((edge) => {
      const sourcePos = positions.get(edge.source);
      const targetPos = positions.get(edge.target);

      if (sourcePos && targetPos) {
        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = distance * attractionForce;
        const normalizedDx = dx / distance;
        const normalizedDy = dy / distance;

        const fSource = forces.get(edge.source)!;
        const fTarget = forces.get(edge.target)!;

        fSource.x += normalizedDx * force;
        fSource.y += normalizedDy * force;
        fTarget.x -= normalizedDx * force;
        fTarget.y -= normalizedDy * force;
      }
    });

    // Update positions
    nodes.forEach((node) => {
      const pos = positions.get(node.serviceName)!;
      const force = forces.get(node.serviceName)!;

      pos.x += force.x * 0.1;
      pos.y += force.y * 0.1;

      // Keep nodes within bounds
      pos.x = Math.max(padding, Math.min(width - padding, pos.x));
      pos.y = Math.max(padding, Math.min(height - padding, pos.y));
    });
  }

  // Create layout nodes and edges
  const layoutNodes: LayoutNode[] = nodes.map((node) => ({
    ...node,
    position: positions.get(node.serviceName) || { x: centerX, y: centerY },
  }));

  const layoutEdges: LayoutEdge[] = edges.map((edge) => {
    const sourcePos = positions.get(edge.source) || { x: centerX, y: centerY };
    const targetPos = positions.get(edge.target) || { x: centerX, y: centerY };
    return {
      ...edge,
      sourcePos,
      targetPos,
    };
  });

  return { nodes: layoutNodes, edges: layoutEdges };
}

/**
 * Get health status and color based on error rate
 */
function getHealthStatus(errorRate: number): {
  status: "healthy" | "warning" | "critical";
  color: string;
  bgColor: string;
  textColor: string;
} {
  if (errorRate >= 10) {
    return {
      status: "critical",
      color: "#ef4444", // red
      bgColor: "bg-red-50",
      textColor: "text-red-700",
    };
  } else if (errorRate >= 1) {
    return {
      status: "warning",
      color: "#f59e0b", // amber
      bgColor: "bg-amber-50",
      textColor: "text-amber-700",
    };
  }
  return {
    status: "healthy",
    color: "#22c55e", // green
    bgColor: "bg-green-50",
    textColor: "text-green-700",
  };
}

export function ServiceMapDiagram({
  nodes,
  edges,
  isLoading = false,
  onServiceClick,
}: ServiceMapDiagramProps) {
  const [hoveredService, setHoveredService] = useState<string | null>(null);

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const layout = calculateLayout(nodes, edges, 1000, 600);
    return {
      layoutNodes: layout.nodes,
      layoutEdges: layout.edges,
    };
  }, [nodes, edges]);

  const handleServiceHover = useCallback((serviceName: string | null) => {
    setHoveredService(serviceName);
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Service Topology
          </CardTitle>
          <CardDescription>Service dependencies and relationships</CardDescription>
        </CardHeader>
        <CardContent className="h-[600px] flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    );
  }

  if (nodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Service Topology
          </CardTitle>
          <CardDescription>Service dependencies and relationships</CardDescription>
        </CardHeader>
        <CardContent className="h-[600px] flex items-center justify-center">
          <div className="text-center space-y-2">
            <Activity className="h-12 w-12 mx-auto opacity-50" />
            <p className="text-sm text-muted-foreground">No services found</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Service Topology
        </CardTitle>
        <CardDescription>Service dependencies and relationships</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <svg
          width="100%"
          height={600}
          viewBox="0 0 1000 600"
          className="border-t bg-gradient-to-br from-slate-50 to-slate-100"
        >
          {/* Draw edges first (so they appear behind nodes) */}
          {layoutEdges.map((edge, idx) => {
            const isHighlighted =
              hoveredService === edge.source || hoveredService === edge.target;

            return (
              <g key={`edge-${idx}`}>
                {/* Edge line */}
                <line
                  x1={edge.sourcePos.x}
                  y1={edge.sourcePos.y}
                  x2={edge.targetPos.x}
                  y2={edge.targetPos.y}
                  stroke={isHighlighted ? "#3b82f6" : "#d1d5db"}
                  strokeWidth={isHighlighted ? 2 : 1}
                  opacity={isHighlighted ? 1 : 0.6}
                  className="transition-all duration-200"
                />

                {/* Arrow head */}
                <defs>
                  <marker
                    id={`arrowhead-${idx}`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="9"
                    refY="3"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 10 3, 0 6"
                      fill={isHighlighted ? "#3b82f6" : "#d1d5db"}
                    />
                  </marker>
                </defs>

                {/* Edge request count label */}
                <text
                  x={(edge.sourcePos.x + edge.targetPos.x) / 2}
                  y={(edge.sourcePos.y + edge.targetPos.y) / 2 - 5}
                  fontSize="11"
                  fill="#666"
                  textAnchor="middle"
                  className="pointer-events-none"
                >
                  {edge.requestCount}
                </text>
              </g>
            );
          })}

          {/* Draw nodes */}
          {layoutNodes.map((node) => {
            const health = getHealthStatus(node.errorRate);
            const isHovered = hoveredService === node.serviceName;
            const relatedEdges = layoutEdges.filter(
              (e) => e.source === node.serviceName || e.target === node.serviceName
            );

            return (
              <g
                key={`node-${node.serviceName}`}
                onMouseEnter={() => handleServiceHover(node.serviceName)}
                onMouseLeave={() => handleServiceHover(null)}
                onClick={() => onServiceClick?.(node.serviceName)}
                className={cn("cursor-pointer", onServiceClick ? "group" : "")}
              >
                {/* Node circle background */}
                <circle
                  cx={node.position.x}
                  cy={node.position.y}
                  r={isHovered ? 45 : 40}
                  fill={health.color}
                  fillOpacity={isHovered ? 0.15 : 0.1}
                  stroke={health.color}
                  strokeWidth={isHovered ? 3 : 2}
                  className="transition-all duration-200"
                />

                {/* Inner circle for health indicator */}
                <circle
                  cx={node.position.x}
                  cy={node.position.y}
                  r={isHovered ? 35 : 32}
                  fill="white"
                  stroke={health.color}
                  strokeWidth={isHovered ? 2 : 1.5}
                  className="transition-all duration-200"
                />

                {/* Health icon in center */}
                {health.status === "critical" && (
                  <circle
                    cx={node.position.x}
                    cy={node.position.y}
                    r={8}
                    fill="#ef4444"
                  />
                )}
                {health.status === "warning" && (
                  <circle
                    cx={node.position.x}
                    cy={node.position.y}
                    r={8}
                    fill="#f59e0b"
                  />
                )}
                {health.status === "healthy" && (
                  <circle
                    cx={node.position.x}
                    cy={node.position.y}
                    r={8}
                    fill="#22c55e"
                  />
                )}

                {/* Service name label (below node) */}
                <text
                  x={node.position.x}
                  y={node.position.y + 60}
                  fontSize={isHovered ? 13 : 12}
                  fontWeight={isHovered ? 600 : 500}
                  textAnchor="middle"
                  fill="#1f2937"
                  className="transition-all duration-200 select-none"
                  pointerEvents="none"
                >
                  {node.serviceName.length > 15
                    ? node.serviceName.substring(0, 15) + "..."
                    : node.serviceName}
                </text>

                {/* Tooltip on hover */}
                {isHovered && (
                  <g pointerEvents="none">
                    {/* Tooltip background */}
                    <rect
                      x={node.position.x - 80}
                      y={node.position.y - 90}
                      width={160}
                      height={80}
                      rx={4}
                      fill="white"
                      stroke="#e5e7eb"
                      strokeWidth={1}
                      filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
                    />

                    {/* Tooltip content */}
                    <text
                      x={node.position.x}
                      y={node.position.y - 70}
                      fontSize="12"
                      fontWeight="600"
                      textAnchor="middle"
                      fill="#1f2937"
                    >
                      {node.serviceName}
                    </text>

                    <text
                      x={node.position.x}
                      y={node.position.y - 55}
                      fontSize="11"
                      textAnchor="middle"
                      fill="#666"
                    >
                      Reqs: {node.requestCount}
                    </text>

                    <text
                      x={node.position.x}
                      y={node.position.y - 40}
                      fontSize="11"
                      textAnchor="middle"
                      fill={health.color}
                    >
                      Error Rate: {node.errorRate.toFixed(2)}%
                    </text>

                    <text
                      x={node.position.x}
                      y={node.position.y - 25}
                      fontSize="11"
                      textAnchor="middle"
                      fill="#666"
                    >
                      P95: {node.p95Latency.toFixed(0)}ms
                    </text>

                    <text
                      x={node.position.x}
                      y={node.position.y - 10}
                      fontSize="11"
                      textAnchor="middle"
                      fill="#666"
                    >
                      Errors: {node.errorCount}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 px-6 py-4 border-t bg-muted/20 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-green-500" />
            <span>Healthy (&lt;1% errors)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-amber-500" />
            <span>Warning (1-10% errors)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500" />
            <span>Critical (&gt;10% errors)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

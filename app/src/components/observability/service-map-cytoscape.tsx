/**
 * ServiceMapCytoscape
 * Professional service topology visualization using Cytoscape.js
 * Supports zoom, pan, and force-directed layout
 */

"use client";

import React, { useRef, useState, useEffect } from "react";
import { useTheme } from "next-themes";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import coseLay from "cytoscape-cose-bilkent";
import type { ServiceNode, ServiceEdge } from "~/types/observability";
import { Button } from "~/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "~/lib/utils";

interface ServiceMapCytoscapeProps {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  onServiceClick?: (serviceName: string) => void;
}

// Register layout
cytoscape.use(coseLay);

export function ServiceMapCytoscape({
  nodes,
  edges,
  onServiceClick,
}: ServiceMapCytoscapeProps) {
  const { theme, systemTheme } = useTheme();
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [hoveredNodeData, setHoveredNodeData] = useState<ServiceNode | null>(null);

  const isDark = theme === "dark" || (theme === "system" && systemTheme === "dark");

  // Convert service nodes to cytoscape elements
  const elements = [
    // Nodes
    ...nodes.map((node) => ({
      data: {
        id: node.serviceName,
        label: node.serviceName,
        errorRate: node.errorRate,
        requestCount: node.requestCount,
        p95Latency: node.p95Latency,
        avgLatency: node.avgLatency,
      },
      classes: getHealthClass(node.errorRate),
    })),
    // Edges
    ...edges.map((edge) => ({
      data: {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edge.requestCount.toString(),
        errorRate: edge.errorRate,
        avgLatency: edge.avgLatency,
      },
    })),
  ];

  const handleZoomIn = () => {
    if (!cyRef.current) return;
    const currentZoom = cyRef.current.zoom();
    cyRef.current.zoom(currentZoom * 1.1);
  };

  const handleZoomOut = () => {
    if (!cyRef.current) return;
    const currentZoom = cyRef.current.zoom();
    cyRef.current.zoom(currentZoom / 1.1);
  };

  const handleFitToScreen = () => {
    if (!cyRef.current) return;
    cyRef.current.fit();
  };

  const handleNodeClick = (evt: cytoscape.EventObject) => {
    const target = evt.target;
    if (target && typeof target.id === "function") {
      const nodeId = target.id();
      onServiceClick?.(nodeId);
    }
  };

  useEffect(() => {
    if (!cyRef.current) return;

    const handleNodeHover = (evt: cytoscape.EventObject) => {
      const target = evt.target;
      if (target && typeof target.id === "function") {
        const nodeId = target.id();
        const nodeData = nodes.find((n) => n.serviceName === nodeId);
        setHoveredNodeData(nodeData || null);
      }
    };

    const handleNodeUnhover = () => {
      setHoveredNodeData(null);
    };

    cyRef.current.on("mouseover", "node", handleNodeHover);
    cyRef.current.on("mouseout", "node", handleNodeUnhover);

    return () => {
      if (cyRef.current) {
        cyRef.current.off("mouseover", "node", handleNodeHover);
        cyRef.current.off("mouseout", "node", handleNodeUnhover);
      }
    };
  }, [nodes]);

  return (
    <div className={`w-full h-full flex flex-col relative ${isDark ? "service-map-canvas-dark" : "service-map-canvas-light"}`}>
      {/* Cytoscape Container */}
      <div style={{ position: "relative", flex: 1, zIndex: 2 }}>
        <CytoscapeComponent
          elements={elements}
          style={{
            width: "100%",
            height: "100%",
            background: "transparent"
          }}
          stylesheet={getCytoscapeStyle(isDark)}
          layout={{
            name: "cose-bilkent",
            directed: true,
            animate: true,
            animationDuration: 500,
            avoidOverlap: true,
            nodeSpacing: 50,
            fit: true,
            padding: 100,
            randomize: false,
            componentSpacing: 100,
            nodeRepulsion: 400000,
            edgeElasticity: 100,
            nestingFactor: 1.2,
            gravity: 250,
            numIter: 200,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.75,
            maxSimulationTime: 4000,
          } as cytoscape.LayoutOptions}
          cy={(cy: cytoscape.Core) => {
            cyRef.current = cy;
            cy.on("tap", handleNodeClick);
            // Constrain viewport to reasonable bounds
            cy.minZoom(0.5);
            cy.maxZoom(3);
          }}
        />
      </div>

      {/* Hover Tooltip - Premium Card Style */}
      {hoveredNodeData && (
        <div className={`absolute top-6 left-6 backdrop-blur-sm rounded-xl shadow-xl p-5 max-w-sm pointer-events-none animate-tooltip-in z-50 ${
          isDark
            ? "bg-slate-900/95 border border-slate-700/50"
            : "bg-white/95 border border-white/40"
        }`}>
          {/* Header */}
          <div className="mb-4">
            <h3 className={`font-bold text-base truncate ${isDark ? "text-slate-100" : "text-slate-900"}`}>
              {hoveredNodeData.serviceName}
            </h3>
            <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>Service Details</p>
          </div>

          {/* Status Badge Row */}
          <div className={`mb-4 pb-4 border-b ${isDark ? "border-slate-700/50" : "border-slate-100"}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-600"}`}>Status</span>
              <span
                className={cn(
                  "px-3 py-1.5 rounded-full font-semibold text-xs text-white transition-all duration-200",
                  hoveredNodeData.errorRate >= 10
                    ? "bg-red-500"
                    : hoveredNodeData.errorRate >= 1
                      ? "bg-amber-500"
                      : "bg-green-500"
                )}
              >
                {hoveredNodeData.errorRate >= 10
                  ? "Critical"
                  : hoveredNodeData.errorRate >= 1
                    ? "Warning"
                    : "Healthy"}
              </span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="space-y-3">
            {/* Requests */}
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>Requests</span>
              <span className={`font-bold text-sm ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                {hoveredNodeData.requestCount.toLocaleString()}
              </span>
            </div>

            {/* Error Rate */}
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>Error Rate</span>
              <span
                className={cn(
                  "font-bold text-sm",
                  hoveredNodeData.errorRate >= 10
                    ? "text-red-600"
                    : hoveredNodeData.errorRate >= 1
                      ? "text-amber-600"
                      : "text-green-600"
                )}
              >
                {hoveredNodeData.errorRate.toFixed(2)}%
              </span>
            </div>

            {/* Avg Latency */}
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>Avg Latency</span>
              <span className={`font-bold text-sm ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                {hoveredNodeData.avgLatency.toFixed(0)}ms
              </span>
            </div>

            {/* P95 Latency */}
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>P95 Latency</span>
              <span className={`font-bold text-sm ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                {hoveredNodeData.p95Latency.toFixed(0)}ms
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Floating controls */}
      <div className={`absolute bottom-4 right-4 flex flex-col gap-2 rounded-lg shadow-lg border p-2 ${
        isDark
          ? "bg-slate-800/90 border-slate-700/50"
          : "bg-white border-border/50"
      }`}>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0"
          onClick={handleZoomIn}
          title="Zoom in"
        >
          <ZoomIn className="h-5 w-5" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0"
          onClick={handleZoomOut}
          title="Zoom out"
        >
          <ZoomOut className="h-5 w-5" />
        </Button>

        <div className="w-full h-px bg-border/30" />

        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0"
          onClick={handleFitToScreen}
          title="Fit to screen"
        >
          <Maximize2 className="h-5 w-5" />
        </Button>
      </div>

      {/* Info text */}
      <div className={`absolute bottom-4 left-4 text-xs backdrop-blur rounded px-2 py-1 ${
        isDark
          ? "text-slate-400 bg-slate-800/80"
          : "text-muted-foreground bg-white/80"
      }`}>
        Click nodes for details • Scroll to zoom • Drag to pan
      </div>
    </div>
  );
}

function getHealthClass(errorRate: number): string {
  if (errorRate >= 10) return "critical";
  if (errorRate >= 1) return "warning";
  return "healthy";
}

function getCytoscapeStyle(isDark = false): Array<Record<string, unknown>> {
  const bgColor = isDark ? "#2d2d2d" : "#ffffff";
  const textColor = isDark ? "#e5e5e5" : "#1f2937";
  const edgeColor = isDark ? "#4a4a4a" : "#cbd5e1";
  const edgeArrowColor = isDark ? "#4a4a4a" : "#cbd5e1";

  return [
    {
      selector: "node",
      style: {
        "background-color": bgColor,
        "border-color": (ele: cytoscape.NodeSingular) => {
          const errorRate = ele.data("errorRate") as number;
          if (errorRate >= 10) return "#ef4444";
          if (errorRate >= 1) return "#f59e0b";
          return "#22c55e";
        },
        "border-width": 3,
        width: 60,
        height: 60,
        label: "data(label)",
        "text-valign": "bottom",
        "text-halign": "center",
        "font-size": 12,
        "font-weight": "bold",
        color: textColor,
        "text-margin-y": 10,
        "overlay-opacity": 0,
        "shadow-blur": 10,
        "shadow-color": (ele: cytoscape.NodeSingular) => {
          const errorRate = ele.data("errorRate") as number;
          if (errorRate >= 10) return "rgba(239, 68, 68, 0.3)";
          if (errorRate >= 1) return "rgba(245, 158, 11, 0.3)";
          return "rgba(34, 197, 94, 0.3)";
        },
        "shadow-opacity": (ele: cytoscape.NodeSingular) => {
          return ele.selected() ? 1 : 0;
        },
        "shadow-offset-x": 0,
        "shadow-offset-y": 0,
      },
    },
    {
      selector: "node.critical",
      style: {
        "background-color": "rgba(239, 68, 68, 0.1)",
      },
    },
    {
      selector: "node.warning",
      style: {
        "background-color": "rgba(245, 158, 11, 0.1)",
      },
    },
    {
      selector: "node.healthy",
      style: {
        "background-color": "rgba(34, 197, 94, 0.1)",
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-width": 4,
        width: 70,
        height: 70,
      },
    },
    {
      selector: "node:hover",
      style: {
        "border-width": 4,
        width: 70,
        height: 70,
        cursor: "pointer",
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "target-arrow-color": edgeArrowColor,
        "line-color": edgeColor,
        width: 2,
        "text-background-color": bgColor,
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        label: "data(label)",
        "font-size": 10,
        color: "#666",
        "arrow-scale": 1.5,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "edge:hover",
      style: {
        "line-color": "#3b82f6",
        "target-arrow-color": "#3b82f6",
        width: 3,
      },
    },
    {
      selector: ":selected",
      style: {
        "overlay-opacity": 0.2,
        "overlay-color": "#3b82f6",
        "overlay-padding": 10,
      },
    },
  ];
}

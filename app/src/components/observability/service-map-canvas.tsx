/**
 * ServiceMapCanvas
 * Interactive canvas-based service topology with zoom and pan
 * Supports mouse wheel zoom and drag to pan
 */

"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { ServiceNode, ServiceEdge } from "~/types/observability";

interface ServiceMapCanvasProps {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
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
 * Force-directed layout algorithm
 */
function calculateLayout(
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  width: number = 1200,
  height: number = 700
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const padding = 100;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions: Map<string, Position> = new Map();
  const radius = Math.min(width, height) / 3;

  // Initialize positions in circle
  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    positions.set(node.serviceName, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  // Force-directed iterations
  const iterations = 50;
  const repulsionForce = 150;
  const attractionForce = 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Map<string, { x: number; y: number }> = new Map();

    nodes.forEach((node) => {
      forces.set(node.serviceName, { x: 0, y: 0 });
    });

    // Repulsion
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

    // Attraction
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

      pos.x = Math.max(padding, Math.min(width - padding, pos.x));
      pos.y = Math.max(padding, Math.min(height - padding, pos.y));
    });
  }

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

function getHealthColor(errorRate: number): string {
  if (errorRate >= 10) return "#ef4444";
  if (errorRate >= 1) return "#f59e0b";
  return "#22c55e";
}


export function ServiceMapCanvas({
  nodes,
  edges,
  onServiceClick,
}: ServiceMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Position>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Position>({ x: 0, y: 0 });
  const [hoveredService, setHoveredService] = useState<string | null>(null);

  const layout = React.useMemo(
    () => calculateLayout(nodes, edges, 1200, 700),
    [nodes, edges]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 0.5;
    const gridSize = 50;
    for (let x = pan.x % gridSize; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = pan.y % gridSize; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Transform
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw edges
    layout.edges.forEach((edge) => {
      const isHighlighted =
        hoveredService === edge.source || hoveredService === edge.target;
      const color = isHighlighted ? "#3b82f6" : "#cbd5e1";
      const width = isHighlighted ? 2 : 1;

      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(edge.sourcePos.x, edge.sourcePos.y);
      ctx.lineTo(edge.targetPos.x, edge.targetPos.y);
      ctx.stroke();

      // Draw arrowhead
      const headlen = 15;
      const angle = Math.atan2(
        edge.targetPos.y - edge.sourcePos.y,
        edge.targetPos.x - edge.sourcePos.x
      );
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(edge.targetPos.x, edge.targetPos.y);
      ctx.lineTo(
        edge.targetPos.x - headlen * Math.cos(angle - Math.PI / 6),
        edge.targetPos.y - headlen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        edge.targetPos.x - headlen * Math.cos(angle + Math.PI / 6),
        edge.targetPos.y - headlen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      // Draw request count label
      const labelX = (edge.sourcePos.x + edge.targetPos.x) / 2;
      const labelY = (edge.sourcePos.y + edge.targetPos.y) / 2 - 10;
      ctx.fillStyle = "#666";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(edge.requestCount.toString(), labelX, labelY);
    });

    // Draw nodes
    layout.nodes.forEach((node) => {
      const isHovered = hoveredService === node.serviceName;
      const healthColor = getHealthColor(node.errorRate);
      const nodeRadius = isHovered ? 45 : 40;

      // Outer circle (health indicator)
      ctx.fillStyle = healthColor;
      ctx.globalAlpha = isHovered ? 0.15 : 0.1;
      ctx.beginPath();
      ctx.arc(node.position.x, node.position.y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = healthColor;
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.beginPath();
      ctx.arc(node.position.x, node.position.y, nodeRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner circle
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(
        node.position.x,
        node.position.y,
        isHovered ? 35 : 32,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.strokeStyle = healthColor;
      ctx.lineWidth = isHovered ? 2 : 1.5;
      ctx.stroke();

      // Health dot
      ctx.fillStyle = healthColor;
      ctx.beginPath();
      ctx.arc(node.position.x, node.position.y, 8, 0, Math.PI * 2);
      ctx.fill();

      // Service name
      ctx.fillStyle = "#1f2937";
      ctx.font = `${isHovered ? 600 : 500} 12px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(
        node.serviceName.length > 15
          ? node.serviceName.substring(0, 15) + "..."
          : node.serviceName,
        node.position.x,
        node.position.y + 60
      );

      // Tooltip on hover
      if (isHovered) {
        const tooltipWidth = 160;
        const tooltipHeight = 80;
        const tooltipX = node.position.x - tooltipWidth / 2;
        const tooltipY = node.position.y - 100;

        // Tooltip background
        ctx.fillStyle = "white";
        ctx.shadowColor = "rgba(0,0,0,0.1)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 1;
        ctx.shadowColor = "transparent";
        ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

        // Tooltip text
        ctx.fillStyle = "#1f2937";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(node.serviceName, tooltipX + 8, tooltipY + 18);

        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#666";
        ctx.fillText(`Reqs: ${node.requestCount}`, tooltipX + 8, tooltipY + 33);
        ctx.fillText(
          `Error: ${node.errorRate.toFixed(2)}%`,
          tooltipX + 8,
          tooltipY + 48
        );
        ctx.fillText(`P95: ${node.p95Latency.toFixed(0)}ms`, tooltipX + 8, tooltipY + 63);
      }
    });

    ctx.restore();

    // Draw zoom indicator
    ctx.fillStyle = "#666";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`Zoom: ${(zoom * 100).toFixed(0)}%`, width - 10, height - 10);
  }, [layout, zoom, pan, hoveredService]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(3, zoom * zoomFactor));

    // Pan to zoom towards mouse
    setPan((prev) => ({
      x: mouseX - ((mouseX - prev.x) * newZoom) / zoom,
      y: mouseY - ((mouseY - prev.y) * newZoom) / zoom,
    }));

    setZoom(newZoom);
  }, [zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDragging) {
      setPan((prev) => ({
        x: prev.x + (e.clientX - dragStart.x),
        y: prev.y + (e.clientY - dragStart.y),
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    } else {
      // Check hover on nodes
      const unzoomedX = (x - pan.x) / zoom;
      const unzoomedY = (y - pan.y) / zoom;

      let hoveredNode: string | null = null;
      for (const node of layout.nodes) {
        const dist = Math.sqrt(
          Math.pow(unzoomedX - node.position.x, 2) +
            Math.pow(unzoomedY - node.position.y, 2)
        );
        if (dist < 50) {
          hoveredNode = node.serviceName;
          break;
        }
      }
      setHoveredService(hoveredNode);
    }
  }, [isDragging, dragStart, pan, zoom, layout.nodes]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || isDragging) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;

      for (const node of layout.nodes) {
        const dist = Math.sqrt(
          Math.pow(x - node.position.x, 2) + Math.pow(y - node.position.y, 2)
        );
        if (dist < 50) {
          onServiceClick?.(node.serviceName);
          break;
        }
      }
    },
    [layout.nodes, pan, zoom, isDragging, onServiceClick]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  return (
    <div className="w-full h-full flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={1200}
        height={700}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleCanvasClick}
        onMouseLeave={() => setHoveredService(null)}
        className="w-full border rounded-lg bg-slate-50 cursor-grab active:cursor-grabbing"
      />
      <div className="text-xs text-muted-foreground text-center">
        Scroll to zoom • Drag to pan • Click on nodes for details
      </div>
    </div>
  );
}

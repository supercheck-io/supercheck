import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type { SreEvidenceGraphEdge, SreEvidenceGraphNode } from "@/lib/sre/evidence-graph-queries";
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

export function SreEvidenceGraphSidePanel({ node, edges, nodesById }: SreEvidenceGraphSidePanelProps) {
  if (!node) {
    return (
      <Card className="h-full rounded-3xl">
        <CardHeader>
          <CardTitle>Node details</CardTitle>
          <CardDescription>Select a graph node to inspect source links and relationships.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const connectedEdges = edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 8);

  return (
    <Card className="h-full rounded-3xl">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">{node.type}</Badge>
          {node.status && <Badge variant="outline" className="capitalize">{node.status.replace(/_/g, " ")}</Badge>}
        </div>
        <div>
          <CardTitle className="line-clamp-3 text-base">{node.title}</CardTitle>
          <CardDescription>{node.subtitle ?? formatDate(node.createdAt)}</CardDescription>
        </div>
        {node.href && (
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href={node.href}>
              Open source
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Created</p>
          <p className="text-sm">{formatDate(node.createdAt)}</p>
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

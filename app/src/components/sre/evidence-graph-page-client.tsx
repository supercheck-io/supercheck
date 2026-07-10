"use client";

import { useSearchParams } from "next/navigation";

import { SreEvidenceGraph } from "@/components/sre/evidence-graph";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useSreEvidenceGraph } from "@/hooks/use-sre";
import type { SreEvidenceGraph as SreEvidenceGraphData } from "@/lib/sre/evidence-graph-queries";

const EMPTY_GRAPH: SreEvidenceGraphData = {
  nodes: [],
  edges: [],
  stats: {
    service: 0,
    monitor: 0,
    job: 0,
    alert: 0,
    incident: 0,
    investigation: 0,
    evidence: 0,
    recommendation: 0,
    deployment: 0,
    commit: 0,
    recollection: 0,
    playbook: 0,
  },
};

export function SreEvidenceGraphPageClient() {
  const searchParams = useSearchParams();
  const query = useSreEvidenceGraph();
  const service = searchParams.get("service");
  const selectedServiceNodeId =
    service && /^[0-9a-f-]{36}$/i.test(service) ? `service:${service}` : null;

  if (!query.data) {
    if (query.isPending) {
      return (
        <SuperCheckLoading
          className="h-full"
          message="Loading Investigation Map..."
        />
      );
    }

    return (
      <SreEvidenceGraph
        graph={EMPTY_GRAPH}
        loadError={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load Investigation Map"
        }
        initialSelectedNodeId={selectedServiceNodeId}
      />
    );
  }

  return (
    <SreEvidenceGraph
      graph={query.data.graph}
      loadError={query.data.success ? null : query.data.error}
      initialSelectedNodeId={selectedServiceNodeId}
    />
  );
}

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreEvidenceGraph } from "@/components/sre/evidence-graph";
import { getSreEvidenceGraph } from "@/lib/sre/evidence-graph-queries";

export const dynamic = "force-dynamic";

export default async function SreEvidenceGraphPage() {
  const result = await getSreEvidenceGraph();

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Investigate", href: "/copilot" },
          { label: "Evidence Graph", isCurrentPage: true },
        ]}
      />
      <div className="min-h-0 flex-1 p-4">
        <SreEvidenceGraph
          graph={result.graph}
          loadError={result.success ? null : result.error}
        />
      </div>
    </div>
  );
}

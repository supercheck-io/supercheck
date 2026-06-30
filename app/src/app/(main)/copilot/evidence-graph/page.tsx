import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreEvidenceGraph } from "@/components/sre/evidence-graph";
import { getSreEvidenceGraph } from "@/lib/sre/evidence-graph-queries";

export const dynamic = "force-dynamic";

export default async function SreEvidenceGraphPage() {
  const result = await getSreEvidenceGraph();

  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Investigate", href: "/copilot" },
          { label: "Evidence Graph", isCurrentPage: true },
        ]}
      />
      <div className="m-4 mb-8">
        <SreEvidenceGraph
          graph={result.graph}
          loadError={result.success ? null : result.error}
        />
      </div>
    </div>
  );
}

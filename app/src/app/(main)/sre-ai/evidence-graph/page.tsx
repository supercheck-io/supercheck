import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreEvidenceGraph } from "@/components/sre/evidence-graph";
import { getSreEvidenceGraph } from "@/lib/sre/evidence-graph-queries";

export default async function SreEvidenceGraphPage() {
  const result = await getSreEvidenceGraph();

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "SRE AI", href: "/sre-ai" },
          { label: "Evidence Graph", isCurrentPage: true },
        ]}
      />
      <SreEvidenceGraph graph={result.graph} loadError={result.success ? null : result.error} />
    </div>
  );
}

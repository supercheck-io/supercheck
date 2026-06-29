import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreEvidenceGraph } from "@/components/sre/evidence-graph";
import { listSreEvidenceGraphFocusedViews } from "@/actions/sre-evidence-graph-views";
import { getSreEvidenceGraph } from "@/lib/sre/evidence-graph-queries";

export default async function SreEvidenceGraphPage() {
  const [result, focusedViewsResult] = await Promise.all([
    getSreEvidenceGraph(),
    listSreEvidenceGraphFocusedViews(),
  ]);

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "SRE AI", href: "/sre-ai" },
          { label: "Evidence Graph", isCurrentPage: true },
        ]}
      />
      <SreEvidenceGraph
        graph={result.graph}
        loadError={result.success ? null : result.error}
        initialSharedFocusedViews={focusedViewsResult.views}
        sharedFocusedViewsError={focusedViewsResult.success ? null : focusedViewsResult.error}
      />
    </div>
  );
}

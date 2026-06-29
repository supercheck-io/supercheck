import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreInvestigationsTable } from "@/components/sre/investigations-table";
import { getSreInvestigationHistory } from "@/lib/sre/investigation-queries";

export default async function SreInvestigationsPage() {
  const result = await getSreInvestigationHistory();

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Investigate", href: "/sre-ai" },
          { label: "Investigation History", isCurrentPage: true },
        ]}
      />
      <SreInvestigationsTable
        investigations={result.investigations}
        loadError={result.success ? null : result.error}
      />
    </div>
  );
}

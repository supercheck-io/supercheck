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
          { label: "SRE AI", href: "/sre-ai" },
          { label: "Investigations", isCurrentPage: true },
        ]}
      />
      <SreInvestigationsTable
        investigations={result.investigations}
        loadError={result.success ? null : result.error}
      />
    </div>
  );
}

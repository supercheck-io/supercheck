import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreInvestigationsTable } from "@/components/sre/investigations-table";
import { getSreInvestigationHistory } from "@/lib/sre/investigation-queries";

export const dynamic = "force-dynamic";

export default async function SreInvestigationsPage() {
  const result = await getSreInvestigationHistory();

  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Investigate", href: "/copilot" },
          { label: "Investigation History", isCurrentPage: true },
        ]}
      />
      <div className="m-4 mb-8">
        <SreInvestigationsTable
          investigations={result.investigations}
          loadError={result.success ? null : result.error}
        />
      </div>
    </div>
  );
}

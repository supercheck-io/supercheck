import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentDetailPageClient } from "@/components/sre/incidents/sre-incident-detail-page-client";
import { Card, CardContent } from "@/components/ui/card";

type Params = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

function parseIncidentTab(value: string | string[] | undefined) {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === "investigation" || tab === "evidence" || tab === "brief" ? tab : "overview";
}

export default async function SreIncidentDetailPage({
  params,
  searchParams,
}: Params) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialTab = parseIncidentTab(resolvedSearchParams.tab);
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", href: "/incidents" },
    { label: "Incident", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      {/* No fixed height or overflow clipping: the page has one scrollbar and the sidebar can stick. */}
      <Card className="m-4 min-w-0 shadow-sm">
        <CardContent className="min-w-0 p-4 md:p-6">
          <SreIncidentDetailPageClient
            incidentId={id}
            initialTab={initialTab}
          />
        </CardContent>
      </Card>
    </div>
  );
}

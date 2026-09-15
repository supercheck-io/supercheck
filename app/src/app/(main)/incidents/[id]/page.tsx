import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentDetailPageClient } from "@/components/sre/incidents/sre-incident-detail-page-client";
import { Card, CardContent } from "@/components/ui/card";

type Params = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

function parseIncidentTab(value: string | string[] | undefined) {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === "evidence" || tab === "brief" ? tab : "investigation";
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
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="sr-only">
        <PageBreadcrumbs items={breadcrumbs} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 pb-6">
        <Card className="h-full min-w-0 overflow-hidden shadow-sm">
          <CardContent className="h-full min-w-0 overflow-hidden p-4 md:p-6">
            <SreIncidentDetailPageClient
              incidentId={id}
              initialTab={initialTab}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

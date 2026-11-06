import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { SreIncidentDetailPageClient } from "@/components/sre/incidents/sre-incident-detail-page-client";
import type { IncidentTabParam } from "@/components/sre/incidents/sre-incident-detail-view";

type Params = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

const TABS: readonly IncidentTabParam[] = ["overview", "investigation", "postmortem", "evidence", "brief"];

function parseIncidentTab(value: string | string[] | undefined): IncidentTabParam {
  const tab = Array.isArray(value) ? value[0] : value;
  return TABS.find((known) => known === tab) ?? "overview";
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
      {/* One page card like the other pages; no fixed height, so the page has one scrollbar. */}
      <Card className="m-4 min-w-0 shadow-sm">
        <CardContent className="p-6">
          <SreIncidentDetailPageClient incidentId={id} initialTab={initialTab} />
        </CardContent>
      </Card>
    </div>
  );
}

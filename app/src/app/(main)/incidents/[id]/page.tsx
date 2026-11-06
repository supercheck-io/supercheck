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
    // On desktop the page fits the window (no page scrollbar); each column scrolls on its own.
    <div data-fit-viewport className="flex min-h-0 flex-1 flex-col lg:min-h-[560px] lg:overflow-hidden">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 flex min-h-0 min-w-0 flex-1 flex-col shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col p-6">
          <SreIncidentDetailPageClient incidentId={id} initialTab={initialTab} />
        </CardContent>
      </Card>
    </div>
  );
}

import { getSreIncidentDetails } from "@/actions/sre-incidents";
import { getSreServices } from "@/actions/sre-services";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentDetailView } from "@/components/sre/incidents/sre-incident-detail-view";
import { Card, CardContent } from "@/components/ui/card";
import { notFound } from "next/navigation";

type Params = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

function parseIncidentTab(value: string | string[] | undefined) {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === "evidence" || tab === "brief" ? tab : "investigation";
}

export default async function SreIncidentDetailPage({ params, searchParams }: Params) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialTab = parseIncidentTab(resolvedSearchParams.tab);
  const [result, servicesResult] = await Promise.all([
    getSreIncidentDetails(id),
    getSreServices(),
  ]);

  if (!result.success || !result.detail) {
    notFound();
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", href: "/incidents" },
    { label: `#${result.detail.incident.incidentNumber}`, isCurrentPage: true },
  ];

  return (
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="sr-only">
        <PageBreadcrumbs items={breadcrumbs} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 pb-6">
        <Card className="h-full min-w-0 overflow-hidden shadow-sm transition-shadow duration-200 hover:shadow-md">
          <CardContent className="h-full min-w-0 overflow-hidden p-6">
            <SreIncidentDetailView
              detail={result.detail}
              services={servicesResult.success ? servicesResult.services : []}
              initialTab={initialTab}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

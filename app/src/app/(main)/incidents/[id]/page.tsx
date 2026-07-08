import { getSreIncidentDetails } from "@/actions/sre-incidents";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentDetailView } from "@/components/sre/incidents/sre-incident-detail-view";
import { Card, CardContent } from "@/components/ui/card";
import { notFound } from "next/navigation";

type Params = {
  params: Promise<{ id: string }>;
};

export default async function SreIncidentDetailPage({ params }: Params) {
  const { id } = await params;
  const result = await getSreIncidentDetails(id);

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
            <SreIncidentDetailView detail={result.detail} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <SreIncidentDetailView detail={result.detail} />
        </CardContent>
      </Card>
    </div>
  );
}

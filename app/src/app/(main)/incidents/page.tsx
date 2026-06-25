import { getSreIncidents } from "@/actions/sre-incidents";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentsList } from "@/components/sre/incidents/sre-incidents-list";
import { Card, CardContent } from "@/components/ui/card";

export default async function IncidentsPage() {
  const result = await getSreIncidents();
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <SreIncidentsList
            incidents={result.incidents}
            loadError={result.success ? null : result.error}
          />
        </CardContent>
      </Card>
    </div>
  );
}

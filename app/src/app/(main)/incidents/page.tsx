import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentsPageClient } from "@/components/sre/incidents/sre-incidents-page-client";
import { Card, CardContent } from "@/components/ui/card";

export default function IncidentsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 min-w-0 overflow-hidden shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent className="p-6">
          <SreIncidentsPageClient />
        </CardContent>
      </Card>
    </div>
  );
}

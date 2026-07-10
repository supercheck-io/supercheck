import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentAnalyticsPageClient } from "@/components/sre/incidents/sre-incident-analytics-page-client";
import { Card, CardContent } from "@/components/ui/card";

export default function IncidentAnalyticsPage() {
  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Incidents", href: "/incidents" },
          { label: "Trends", isCurrentPage: true },
        ]}
      />
      <Card className="m-4 min-w-0 overflow-hidden shadow-sm">
        <CardContent className="p-6">
          <SreIncidentAnalyticsPageClient />
        </CardContent>
      </Card>
    </div>
  );
}

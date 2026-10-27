import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentAnalyticsPageClient } from "@/components/sre/incidents/sre-incident-analytics-page-client";
import { Card, CardContent } from "@/components/ui/card";

export default function IncidentAnalyticsPage() {
  return (
    <div data-fit-viewport className="overflow-hidden lg:flex lg:min-h-[560px] lg:flex-1 lg:flex-col">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Incidents", href: "/incidents" },
          { label: "Trends", isCurrentPage: true },
        ]}
      />
      <Card className="m-4 min-w-0 overflow-hidden shadow-sm lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <CardContent className="p-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <SreIncidentAnalyticsPageClient />
        </CardContent>
      </Card>
    </div>
  );
}

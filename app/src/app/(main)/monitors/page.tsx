import MonitorsList from "@/components/monitors/monitors-list";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";

export default function MonitorsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Monitors", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">  
        <CardContent>
          <MonitorsList />
        </CardContent>
      </Card>
     
    </div>
  );
} 
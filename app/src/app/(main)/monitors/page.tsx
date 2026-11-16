import { Suspense } from "react";

import { MonitorsPageTabs } from "@/components/monitors/monitors-page-tabs";
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
      <Card className="m-4 shadow-sm">
        <CardContent className="p-6">
          <Suspense fallback={null}>
            <MonitorsPageTabs />
          </Suspense>
        </CardContent>
      </Card>
     
    </div>
  );
} 
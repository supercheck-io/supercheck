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
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="m-4 shadow-sm flex-1">
        <CardContent className="p-6">
          <Suspense fallback={null}>
            <MonitorsPageTabs />
          </Suspense>
        </CardContent>
      </Card>
     
    </div>
  );
} 
"use client";

import { Suspense } from "react";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import StatusPagesList from "@/components/status-pages/status-pages-list";

export default function StatusPagesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", isCurrentPage: true },
  ];

  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="m-4 shadow-sm flex-1">
        <CardContent className="p-6">
          {/* Suspense boundary required because StatusPagesList (or its children) might use useSearchParams() */}
          <Suspense
            fallback={
              <div className="flex min-h-[400px] items-center justify-center">
                <SupercheckLoading size="md" message="Loading status pages..." />
              </div>
            }
          >
            <StatusPagesList />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

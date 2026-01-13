"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

// StatusPagesList uses client-side only data fetching/rendering which can cause hydration mismatches
// if the server tries to render a loading state while the client has data (or vice versa).
// Disabling SSR for this component ensures consistent client-side behavior.
const StatusPagesList = dynamic(
  () => import("@/components/status-pages/status-pages-list"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[400px] items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading status pages..." />
      </div>
    ),
  }
);

export default function StatusPagesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          {/* Suspense boundary required because StatusPagesList (or its children) might use useSearchParams() */}
          <Suspense
            fallback={
              <div className="flex min-h-[400px] items-center justify-center">
                <SuperCheckLoading size="lg" message="Loading status pages..." />
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

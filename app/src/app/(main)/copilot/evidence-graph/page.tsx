import { Suspense } from "react";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreEvidenceGraphPageClient } from "@/components/sre/evidence-graph-page-client";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function SreEvidenceGraphPage() {
  return (
    <div className="flex h-[calc(100svh-4.25rem)] min-h-0 flex-col overflow-hidden">
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Investigate", href: "/copilot" },
          { label: "Investigation Map", isCurrentPage: true },
        ]}
      />
      <div className="min-h-0 flex-1 p-4 pb-6">
        <Suspense
          fallback={
            <SupercheckLoading
              className="h-full"
              message="Loading Investigation Map..."
            />
          }
        >
          <SreEvidenceGraphPageClient />
        </Suspense>
      </div>
    </div>
  );
}

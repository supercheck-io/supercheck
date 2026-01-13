import { Suspense } from "react";
import { JobCreationWizard } from "@/components/jobs/job-creation-wizard";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

const breadcrumbs = [
  { label: "Home", href: "/" },
  { label: "Jobs", href: "/jobs" },
  { label: "Create", href: "/jobs/create" },
  { label: "Playwright Job", isCurrentPage: true },
];

export default function CreatePlaywrightJobPage() {
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      {/* Suspense boundary required because JobCreationWizard uses useSearchParams() */}
      <Suspense
        fallback={
          <div className="flex min-h-[400px] items-center justify-center">
            <SuperCheckLoading size="lg" message="Loading job wizard..." />
          </div>
        }
      >
        <JobCreationWizard />
      </Suspense>
    </div>
  );
}

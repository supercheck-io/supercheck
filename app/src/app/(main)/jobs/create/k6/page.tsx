import { Suspense } from "react";
import { JobCreationWizardK6 } from "@/components/jobs/job-creation-wizard-k6";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

const breadcrumbs = [
  { label: "Home", href: "/" },
  { label: "Jobs", href: "/jobs" },
  { label: "Create", href: "/jobs/create" },
  { label: "Performance Job", isCurrentPage: true },
];

export default function CreateK6JobPage() {
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      {/* Suspense boundary required because JobCreationWizardK6 uses useSearchParams() */}
      <Suspense
        fallback={
          <div className="flex min-h-[400px] items-center justify-center">
            <SuperCheckLoading size="lg" message="Loading job wizard..." />
          </div>
        }
      >
        <JobCreationWizardK6 />
      </Suspense>
    </div>
  );
}

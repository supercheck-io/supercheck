import { JobCreationWizard } from "@/components/jobs/job-creation-wizard";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

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
      <JobCreationWizard />
    </div>
  );
}

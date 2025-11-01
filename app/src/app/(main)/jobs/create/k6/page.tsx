import { JobCreationWizardK6 } from "@/components/jobs/job-creation-wizard-k6";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

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
      <JobCreationWizardK6 />
    </div>
  );
}

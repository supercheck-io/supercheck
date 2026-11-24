import { JobCreationCard } from "@/components/jobs/job-creation-card";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";

const breadcrumbs = [
  { label: "Home", href: "/" },
  { label: "Jobs", href: "/jobs" },
  { label: "Create", isCurrentPage: true },
];

export default function CreateJobPage() {
  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="m-4 shadow-sm hover:shadow-md transition-shadow duration-200 flex-1">
        <CardContent className="p-6">
          <JobCreationCard />
        </CardContent>
      </Card>
    </div>
  );
}

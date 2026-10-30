"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import EditJob from "@/components/jobs/edit-job";
import { useEffect } from "react";
import { EditJobSkeleton } from "@/components/jobs/edit-job-skeleton";
import { toast } from "sonner";
import { useJob } from "@/hooks/use-jobs";
import { ListErrorState } from "@/components/shared/list-states";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function EditJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  // Use React Query hook for job data - this caches for 60s and prevents duplicate fetches
  const { data: jobData, isLoading, error, refetch } = useJob(jobId);

  // Redirect only when the job is gone; any other failure keeps the page with a Retry.
  useEffect(() => {
    if (error && /not found|HTTP 404/i.test(error.message)) {
      toast.error("Job Not Found", {
        description: "The job you're looking for doesn't exist or has been deleted."
      });
      router.push("/jobs");
    }
  }, [error, router]);

  const jobName = jobData?.name || jobId;

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Jobs", href: "/jobs" },
    { label: jobName.length > 20 ? `${jobName.substring(0, 20)}...` : jobName, href: `/jobs?job=${jobId}` },
    { label: "Edit", isCurrentPage: true },
  ];

  if (isLoading) {
    return (
      <div className=" mx-auto p-4 space-y-4">
        <PageBreadcrumbs items={breadcrumbs} />
        <EditJobSkeleton />
      </div>
    );
  }

  if (error || !jobData) {
    return (
      <div className=" mx-auto p-4 space-y-4">
        <PageBreadcrumbs items={breadcrumbs} />
        <ListErrorState title="Failed to load job" error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className=" mx-auto p-4 space-y-4">
      <PageBreadcrumbs items={breadcrumbs} />
      {/* Suspense boundary required because EditJob uses useSearchParams() */}
      <Suspense
        fallback={
          <div className="flex min-h-[400px] items-center justify-center">
            <SupercheckLoading size="md" message="Loading job editor..." />
          </div>
        }
      >
        <EditJob jobId={jobId} initialJobData={jobData} />
      </Suspense>
    </div>
  );
}


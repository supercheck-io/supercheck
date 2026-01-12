"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import EditJob from "@/components/jobs/edit-job";
import { useEffect } from "react";
import { EditJobSkeleton } from "@/components/jobs/edit-job-skeleton";
import { toast } from "sonner";
import { useJob } from "@/hooks/use-jobs";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

export default function EditJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  // Use React Query hook for job data - this caches for 60s and prevents duplicate fetches
  const { data: jobData, isLoading, error } = useJob(jobId);

  // Redirect to not-found if job doesn't exist
  useEffect(() => {
    if (error) {
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
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold text-destructive">Failed to Load Job</h2>
            <p className="text-muted-foreground">
              We couldn&apos;t load the job details. Please try again.
            </p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => router.push("/jobs")}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
            >
              Back to Jobs
            </button>
          </div>
        </div>
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
            <SuperCheckLoading size="md" message="Loading job editor..." />
          </div>
        }
      >
        <EditJob jobId={jobId} initialJobData={jobData} />
      </Suspense>
    </div>
  );
}


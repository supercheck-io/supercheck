"use client";

import { useParams, useRouter } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import EditJob from "@/components/jobs/edit-job";
import { useEffect, useState } from "react";
import { EditJobSkeleton } from "@/components/jobs/edit-job-skeleton";
import { toast } from "sonner";

export default function EditJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;
  const [isLoading, setIsLoading] = useState(true);
  const [jobName, setJobName] = useState<string>("");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    async function checkJobExists() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, {
          signal: abortController.signal
        });

        if (!response.ok) {
          if (response.status === 404) {
            toast.error("Job Not Found", {
              description: "The job you're looking for doesn't exist or has been deleted."
            });
            router.push("/jobs");
            return;
          }
          throw new Error(`Failed to load job: ${response.statusText}`);
        }

        const jobData = await response.json();
        setJobName(jobData.name || jobId);
        setLoadError(false);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was cancelled, ignore
          return;
        }
        console.error("Error checking job:", error);
        setLoadError(true);
        toast.error("Error Loading Job", {
          description: "Failed to load job details. Please try again."
        });
      } finally {
        setIsLoading(false);
      }
    }

    checkJobExists();

    return () => {
      abortController.abort();
    };
  }, [jobId, router]);
  
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Jobs", href: "/jobs" },
    { label: jobName.length > 20 ? `${jobName.substring(0, 20)}...` : jobName, href: `/jobs?job=${jobId}` },
    { label: "Edit", isCurrentPage: true },
    
  ];

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError(false);
    // Trigger re-fetch by updating a dummy state or use a key
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className=" mx-auto p-4 space-y-4">
        <PageBreadcrumbs items={breadcrumbs} />
        <EditJobSkeleton />
      </div>
    );
  }

  if (loadError) {
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
              onClick={handleRetry}
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
      <EditJob jobId={jobId} />
    </div>
  );
}

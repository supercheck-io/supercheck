"use client";

import { notFound, useParams } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import EditJob from "@/components/jobs/edit-job";
import { useEffect, useState } from "react";
import { EditJobSkeleton } from "@/components/jobs/edit-job-skeleton";

export default function EditJobPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [isLoading, setIsLoading] = useState(true);
  const [jobName, setJobName] = useState<string>("");
  
  useEffect(() => {
    async function checkJobExists() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (!response.ok) {
          notFound();
        }
        const jobData = await response.json();
        setJobName(jobData.name || jobId);
      } catch (error) {
        console.error("Error checking job:", error);
        notFound();
      } finally {
        setIsLoading(false);
      }
    }
    
    checkJobExists();
  }, [jobId]);
  
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

  return (
    <div className=" mx-auto p-4 space-y-4">
      <PageBreadcrumbs items={breadcrumbs} />
      <EditJob jobId={jobId} />
    </div>
  );
}

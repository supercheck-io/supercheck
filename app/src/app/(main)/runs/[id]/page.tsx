import { RunDetails } from "@/components/runs/run-details";
import { getRun } from "@/actions/get-runs";
import { notFound } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type Params = {
  params: Promise<{
    id: string
  }>
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-[300px] w-full" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

export default async function RunPage({ params }: Params) {
  const { id } = await params;
  
  try {
    const run = await getRun(id);
    
    if (!run) {
      notFound();
    }
    
    const breadcrumbs = [
      { label: "Home", href: "/" },
      { label: "Runs", href: "/runs" },
      { label: run.jobName && run.jobName.length > 20 ? `${run.jobName.substring(0, 20)}...` : run.jobName || id, href: `/jobs?job=${run.jobId}` },
      { label: "Report", isCurrentPage: true },
    ];

    return (
      <div>
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="m-4">
          <Suspense fallback={<DetailSkeleton />}>
            <RunDetails run={run} />
          </Suspense>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error fetching run:', error);
    notFound();
  }
}

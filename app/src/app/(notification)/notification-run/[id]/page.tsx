import { RunDetails } from "@/components/runs/run-details";
import { getRun } from "@/actions/get-runs";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

type Params = {
  params: Promise<{
    id: string;
  }>;
};

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

export default async function NotificationRunPage({ params }: Params) {
  const { id } = await params;

  try {
    const run = await getRun(id, true);

    if (!run) {
      notFound();
    }

    return (
      <div className="w-full max-w-full">
        <Suspense fallback={<DetailSkeleton />}>
          <RunDetails run={run} isNotificationView={true} />
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error("Error fetching run:", error);
    notFound();
  }
}

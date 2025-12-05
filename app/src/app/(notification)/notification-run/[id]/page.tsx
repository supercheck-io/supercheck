import { AlertCircle } from "lucide-react";
import { RunDetails } from "@/components/runs/run-details";
import { getRun } from "@/actions/get-runs";
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

// Separate component for not found state
function RunNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="flex flex-col items-center text-center ">
        <AlertCircle className="h-16 w-16 text-amber-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">Run Not Found</h1>
        <p className="text-muted-foreground mb-6">
          This run is unavailable or you do not have access to it.
        </p>
      </div>
    </div>
  );
}

// Separate component for error state
function RunError() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="flex flex-col items-center text-center">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">Error Loading Run</h1>
        <p className="text-muted-foreground">
          Unable to load this run. It may not exist or you may not have
          permission to view it.
        </p>
      </div>
    </div>
  );
}

export default async function NotificationRunPage({ params }: Params) {
  const { id } = await params;

  let run;
  let hasError = false;

  try {
    run = await getRun(id);
  } catch (error) {
    console.error("Error fetching run:", error);
    hasError = true;
  }

  if (hasError) {
    return <RunError />;
  }

  if (!run) {
    return <RunNotFound />;
  }

  return (
    <div className="w-full max-w-full">
      <Suspense fallback={<DetailSkeleton />}>
        <RunDetails run={run} isNotificationView={true} />
      </Suspense>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Skeleton } from "./ui/skeleton";
import { ExecutionsDialog } from "./executions/executions-dialog";
import { useExecutions } from "@/hooks/use-executions";

/**
 * ParallelThreads component - Top bar indicator for running/queued executions
 * 
 * Uses the shared useExecutions hook (SINGLE SOURCE OF TRUTH)
 * Same data source as the ExecutionsDialog for consistency.
 */
export function ParallelThreads() {
  const {
    runningCount,
    queuedCount,
    runningCapacity,
    queuedCapacity,
    loading,
  } = useExecutions();

  const [activeDialogTab, setActiveDialogTab] = useState<
    "running" | "queued" | null
  >(null);

  // Calculate progress percentages
  const runningProgress = Math.min(
    100,
    (runningCount / runningCapacity) * 100
  );
  const queuedProgress = Math.min(
    100,
    (queuedCount / queuedCapacity) * 100
  );

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <>
      <div
        className="flex items-center border border-border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors group"
        onClick={() => setActiveDialogTab("running")}
        title="Click to manage parallel executions"
      >
        <div className="flex items-center text-[11px]">
          <div className="flex flex-col mr-3 text-[10px] font-semibold text-muted-foreground leading-tight">
            <span>PARALLEL</span>
            <span>EXECUTIONS</span>
          </div>

          <div className="flex flex-col mr-4">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`font-medium text-[11px] ${runningCount > 0
                  ? "text-blue-600 dark:text-blue-500"
                  : "text-muted-foreground"
                  }`}
              >
                RUNNING
              </span>
              <span className="text-muted-foreground ml-2 text-[11px]">
                {runningCount}/{runningCapacity}
              </span>
            </div>
            <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-in-out"
                style={{ width: `${runningProgress}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`font-medium text-[11px] ${queuedCount > 0
                  ? "text-amber-600 dark:text-amber-500"
                  : "text-muted-foreground"
                  }`}
              >
                QUEUED
              </span>
              <span className="text-muted-foreground ml-2 text-[11px]">
                {queuedCount}/{queuedCapacity}
              </span>
            </div>
            <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 rounded-full transition-all duration-500 ease-in-out"
                style={{ width: `${queuedProgress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <ExecutionsDialog
        open={activeDialogTab !== null}
        onOpenChange={(open) => !open && setActiveDialogTab(null)}
        defaultTab={activeDialogTab || "running"}
      />
    </>
  );
}

// Loading skeleton for parallel executions component
function LoadingSkeleton() {
  return (
    <div className="flex items-center border border-border rounded-md px-3 py-1.5">
      <div className="flex items-center text-[11px]">
        <div className="flex flex-col mr-3 text-[10px] font-semibold text-muted-foreground leading-tight">
          <span>PARALLEL</span>
          <span>EXECUTIONS</span>
        </div>

        <div className="flex flex-col mr-4">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-[11px] text-muted-foreground">
              RUNNING
            </span>
            <Skeleton className="h-3.5 w-8 ml-2" />
          </div>
          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
            <Skeleton className="h-full w-full opacity-20" />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-[11px] text-muted-foreground">
              QUEUED
            </span>
            <Skeleton className="h-3.5 w-8 ml-2" />
          </div>
          <div className="w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
            <Skeleton className="h-full w-full opacity-20" />
          </div>
        </div>
      </div>
    </div>
  );
}



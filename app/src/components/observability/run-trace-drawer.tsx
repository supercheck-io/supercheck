"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useRunObservability } from "@/hooks/useObservability";
import { TraceViewer } from "./trace-viewer";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

interface RunTraceDrawerProps {
  runId: string;
  trigger: React.ReactNode;
  jobName?: string;
  statusLabel?: string;
}

export function RunTraceDrawer({
  runId,
  trigger,
  jobName,
  statusLabel,
}: RunTraceDrawerProps) {
  const [open, setOpen] = useState(false);
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useRunObservability(open ? runId : null, { enabled: open });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="sm:max-w-3xl w-full">
        <SheetHeader>
          <SheetTitle>Trace for run {runId}</SheetTitle>
          <SheetDescription className="flex flex-col gap-1">
            {jobName && <span className="font-medium">{jobName}</span>}
            {statusLabel && (
              <span className="text-xs text-muted-foreground">
                Status: {statusLabel}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto py-4">
          {isLoading && (
            <div className="flex h-64 items-center justify-center">
              <Spinner size="lg" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Unable to load trace</AlertTitle>
              <AlertDescription>
                <button
                  onClick={() => refetch()}
                  className="underline underline-offset-2"
                >
                  Retry
                </button>
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !error && (
            <TraceViewer
              spans={data?.trace?.spans ?? []}
              showHeader
              className="h-full"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

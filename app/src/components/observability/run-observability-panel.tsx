"use client";

import { RefreshCw, Activity, ShieldAlert } from "lucide-react";
import { useRunObservability } from "@/hooks/useObservability";
import { TraceViewer } from "./trace-viewer";
import { LogViewer } from "./log-viewer";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";

interface RunObservabilityPanelProps {
  runId: string;
  className?: string;
}

export function RunObservabilityPanel({
  runId,
  className,
}: RunObservabilityPanelProps) {
  const { data, isLoading, error, refetch, isFetching } = useRunObservability(
    runId
  );

  const authBlocked = data?.metadata.status === "auth_required";

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTitle>Unable to load observability data</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>Please try again or refresh the page.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const hasTrace = Boolean(data?.trace?.spans?.length);
  const logCount = data?.logs?.length ?? 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">Observability</h2>
          <p className="text-xs text-muted-foreground">
            {hasTrace ? "Trace timeline & logs" : "Logs"} for run {runId}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {authBlocked && (
        <Alert
          variant="default"
          className="bg-muted/40 border-dashed border-border/70"
        >
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Observability disabled</AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>
              {data?.metadata.message ||
                "SigNoz rejected the API request. Add SIGNOZ_API_KEY or set SIGNOZ_DISABLE_AUTH=true in your app env to load traces and logs."}
            </p>
            <p>
              See
              <Link
                href="/observability"
                className="text-primary ml-1 underline"
              >
                observability docs
              </Link>
              for setup steps.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {hasTrace && !authBlocked ? (
          <TraceViewer
            spans={data?.trace?.spans ?? []}
            showHeader
            className="border border-border/60 rounded-lg"
          />
        ) : (
          <Card className="border-dashed border-border/60">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              <Activity className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              {authBlocked
                ? "Tracing is disabled until SigNoz access is configured."
                : "No trace data found for this run."}
            </CardContent>
          </Card>
        )}

        <LogViewer
          logs={!authBlocked ? data?.logs ?? [] : []}
          showHeader
          className="border border-border/60 rounded-lg"
        />

        {!authBlocked && !logCount && (
          <p className="text-center text-xs text-muted-foreground">
            No logs were captured for this run.
          </p>
        )}
      </div>
    </div>
  );
}

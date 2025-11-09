"use client";

import { RefreshCw, Activity, ShieldAlert, Zap, FileText } from "lucide-react";
import { useRunObservability } from "@/hooks/useObservability";
import { TraceViewer } from "./trace-viewer";
import { LogViewer } from "./log-viewer";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
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

  const status = data?.metadata.status;
  const authBlocked = status === "auth_required";

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-3 w-64" />
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
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Unable to load observability data</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2 mt-2">
          <span>Something went wrong. Please try again.</span>
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
  const hasData = hasTrace || logCount > 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">Run Traces & Logs</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasData
              ? `${hasTrace ? "Distributed trace with " : ""}${logCount} log${logCount !== 1 ? "s" : ""}`
              : "Real-time observability data for this run execution"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {authBlocked && (
        <Alert
          variant="destructive"
          className="mb-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        >
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Observability access required</AlertTitle>
          <AlertDescription className="text-sm mt-2">
            Please verify your ClickHouse credentials are properly set up, or contact an administrator.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {/* Trace Section */}
        {hasTrace && !authBlocked ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-blue-500" />
              <h4 className="text-sm font-semibold">Distributed Trace</h4>
            </div>
            <TraceViewer
              spans={data?.trace?.spans ?? []}
              showHeader={false}
              className="border border-border/60 rounded-lg overflow-hidden"
            />
          </div>
        ) : !authBlocked && !hasTrace ? (
          <Card className="border-dashed border-border/60 bg-muted/20">
            <CardContent className="py-8 px-6 text-center">
              <div className="flex justify-center mb-3">
                <div className="p-2.5 bg-blue-500/10 rounded-lg">
                  <Zap className="h-5 w-5 text-blue-500" />
                </div>
              </div>
              <p className="font-medium text-sm mb-1">No trace data captured</p>
              <p className="text-xs text-muted-foreground">
                Trace data will appear here when available
              </p>
            </CardContent>
          </Card>
        ) : authBlocked ? (
          <Card className="border-dashed border-border/60 bg-muted/20">
            <CardContent className="py-8 px-6 text-center">
              <div className="flex justify-center mb-3">
                <div className="p-2.5 bg-red-500/10 rounded-lg">
                  <ShieldAlert className="h-5 w-5 text-red-500" />
                </div>
              </div>
              <p className="font-medium text-sm mb-1">Trace data unavailable</p>
              <p className="text-xs text-muted-foreground">
                Requires proper credentials configuration
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Logs Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FileText className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-semibold">Logs</h4>
          </div>
          {!authBlocked ? (
            <LogViewer
              logs={data?.logs ?? []}
              showHeader={false}
              className="border border-border/60 rounded-lg overflow-hidden"
            />
          ) : (
            <Card className="border-dashed border-border/60 bg-muted/20">
              <CardContent className="py-8 px-6 text-center">
                <div className="flex justify-center mb-3">
                  <div className="p-2.5 bg-red-500/10 rounded-lg">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                </div>
                <p className="font-medium text-sm mb-1">Logs unavailable</p>
                <p className="text-xs text-muted-foreground">
                  Requires proper credentials configuration
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

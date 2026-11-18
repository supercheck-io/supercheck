"use client";

import { format } from "date-fns";
import { ChevronsLeft, ChevronsRight, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRunDuration } from "./heartbeat-format";
import { rowsThatFit, useFitPanelRows } from "./use-fit-panel-rows";

export { rowsThatFit };

export type HeartbeatResultRow = {
  id: string;
  checkedAt: string | Date;
  isUp: boolean;
  responseTimeMs?: number | null;
  details?: Record<string, unknown> | null;
};

type PingKind = "ping" | "fail" | "missed";

const RESULT: Record<PingKind, { label: string; tone: TableBadgeTone }> = {
  ping: { label: "OK", tone: "success" },
  fail: { label: "Failed", tone: "danger" },
  missed: { label: "Missed", tone: "danger" },
};

/** Reads `details.heartbeat` written by the sweep; an older or unknown row falls back to its up/down state. */
export function heartbeatResultKind(row: HeartbeatResultRow): { kind: PingKind; userAgent: string | null } {
  const heartbeat = row.details?.heartbeat as { kind?: unknown; userAgent?: unknown } | undefined;
  const kind = heartbeat?.kind === "ping" || heartbeat?.kind === "fail" || heartbeat?.kind === "missed"
    ? heartbeat.kind
    : row.isUp ? "ping" : "missed";
  return { kind, userAgent: typeof heartbeat?.userAgent === "string" ? heartbeat.userAgent : null };
}

/** A run without /start has no duration; a missed run never had one, so only a real ping explains how to get it. */
function NoDuration({ hint }: { hint: boolean }) {
  const dash = <span className="text-muted-foreground">—</span>;
  if (!hint) return dash;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">—</span>
      </TooltipTrigger>
      <TooltipContent>Call /start to record duration</TooltipContent>
    </Tooltip>
  );
}

interface HeartbeatPingHistoryProps {
  results: HeartbeatResultRow[];
  isLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  /**
   * Called with the rows that fit the panel's own height (desktop only). The panel is a fixed-height
   * flex child, so it is measured directly; useFitPageSize measures the page and would shrink forever here.
   */
  onFitRows?: (rows: number) => void;
}

export function HeartbeatPingHistory({
  results,
  isLoading,
  error,
  onRetry,
  page,
  totalPages,
  total,
  onPageChange,
  onFitRows,
}: HeartbeatPingHistoryProps) {
  const panelRef = useFitPanelRows(onFitRows, '[data-testid="heartbeat-ping-row"]');

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden shadow-sm" data-testid="heartbeat-ping-history">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="text-lg font-semibold">Ping history</CardTitle>
        <CardDescription>
          {!error && results.length > 0
            ? `Showing ${results.length} of ${total} recent ${total === 1 ? "ping" : "pings"}.`
            : "Pings, failures and missed runs for this monitor."}
        </CardDescription>
      </CardHeader>
      <CardContent ref={panelRef} className="flex min-h-0 flex-1 flex-col p-0">
        {error ? (
          <Alert variant="error" className="mx-6 mb-6 w-auto">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              Could not load the ping history.
              {onRetry && (
                <Button variant="ghost" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : isLoading && results.length === 0 ? (
          <div className="space-y-2 px-6 pb-6" aria-busy="true" aria-label="Loading ping history">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center space-y-3 px-6 py-8 text-center" data-testid="heartbeat-ping-history-empty">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
              <HeartPulse className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium text-muted-foreground">No pings yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Send your first ping from the job, for example <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">curl -fsS &lt;ping URL&gt;</code>.
                It shows up here and the monitor turns Up.
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 w-full flex-1 overflow-x-auto lg:overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Time</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Result</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Run duration</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => {
                  const { kind, userAgent } = heartbeatResultKind(row);
                  const duration = formatRunDuration(row.responseTimeMs);
                  return (
                    <TableRow key={row.id} data-testid="heartbeat-ping-row" data-kind={kind}>
                      <TableCell className="whitespace-nowrap px-4 tabular-nums">
                        {format(new Date(row.checkedAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="px-4">
                        <TableBadge tone={RESULT[kind].tone} compact>
                          {RESULT[kind].label}
                        </TableBadge>
                      </TableCell>
                      <TableCell className="px-4 tabular-nums">{duration ?? <NoDuration hint={kind !== "missed"} />}</TableCell>
                      <TableCell className="w-full max-w-0 truncate px-4 font-mono text-xs" title={userAgent ?? undefined}>
                        {kind === "missed" ? (
                          <span className="font-sans text-muted-foreground">No ping before the grace period ended</span>
                        ) : (
                          userAgent ?? <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {totalPages > 1 && !error && (
          <nav className="flex flex-shrink-0 items-center justify-between rounded-b-lg border-t bg-card px-4 py-3" aria-label="Ping history pages">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" className="px-2" onClick={() => onPageChange(1)} disabled={page <= 1 || isLoading} aria-label="First page">
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="min-w-[80px]" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || isLoading} aria-label="Previous page">
                Previous
              </Button>
              <Button variant="outline" size="sm" className="min-w-[60px]" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || isLoading} aria-label="Next page">
                Next
              </Button>
              <Button variant="outline" size="sm" className="px-2" onClick={() => onPageChange(totalPages)} disabled={page >= totalPages || isLoading} aria-label="Last page">
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import type * as React from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { formatRunDuration } from "./heartbeat-format";

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

interface HeartbeatPingHistoryProps {
  results: HeartbeatResultRow[];
  isLoading: boolean;
  error?: Error | null;
  onRetry?: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Ref of the <tbody>, so the page size can fit the viewport (useFitPageSize). */
  bodyRef?: React.Ref<HTMLTableSectionElement>;
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
  bodyRef,
}: HeartbeatPingHistoryProps) {
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden shadow-sm" data-testid="heartbeat-ping-history">
      <CardHeader className="flex-shrink-0">
        <CardTitle className="text-lg font-semibold">Ping history</CardTitle>
        {!error && results.length > 0 && (
          <CardDescription>
            Showing {results.length} of {total} recent {total === 1 ? "ping" : "pings"}.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
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
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center" data-testid="heartbeat-ping-history-empty">
            <p className="text-sm font-medium">No pings yet</p>
            <p className="text-xs text-muted-foreground">Pings, failures and missed runs appear here.</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Time</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Result</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Run duration</TableHead>
                  <TableHead scope="col" className="px-4 text-xs font-medium text-muted-foreground whitespace-nowrap">Client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={bodyRef}>
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
                      <TableCell className="px-4 tabular-nums">{duration ?? <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="max-w-[220px] truncate px-4 font-mono text-xs" title={userAgent ?? undefined}>
                        {kind === "missed" ? (
                          <span className="font-sans text-muted-foreground">No ping before the grace period ended</span>
                        ) : (
                          userAgent ?? <span className="text-muted-foreground">-</span>
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
          <nav className="mt-auto flex flex-shrink-0 items-center justify-between rounded-b-lg border-t bg-card px-4 py-3" aria-label="Ping history pages">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" className="min-w-[80px]" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || isLoading} aria-label="Previous page">
                Previous
              </Button>
              <Button variant="outline" size="sm" className="min-w-[60px]" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || isLoading} aria-label="Next page">
                Next
              </Button>
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  ping: { label: "Ping", tone: "success" },
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
}: HeartbeatPingHistoryProps) {
  return (
    <Card className="flex flex-col shadow-sm" data-testid="heartbeat-ping-history">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-semibold">Ping history</CardTitle>
        {total > 0 && <span className="text-xs text-muted-foreground">Total {total} {total === 1 ? "entry" : "entries"}</span>}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {error ? (
          <Alert variant="error">
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
          <div className="space-y-2" aria-busy="true" aria-label="Loading ping history">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center" data-testid="heartbeat-ping-history-empty">
            <p className="text-sm font-medium">No pings yet</p>
            <p className="text-xs text-muted-foreground">Pings, failures and missed runs appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Time</TableHead>
                  <TableHead scope="col">Result</TableHead>
                  <TableHead scope="col">Run duration</TableHead>
                  <TableHead scope="col">Client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((row) => {
                  const { kind, userAgent } = heartbeatResultKind(row);
                  const duration = formatRunDuration(row.responseTimeMs);
                  return (
                    <TableRow key={row.id} data-testid="heartbeat-ping-row" data-kind={kind}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {format(new Date(row.checkedAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell>
                        <TableBadge tone={RESULT[kind].tone} compact>
                          {RESULT[kind].label}
                        </TableBadge>
                      </TableCell>
                      <TableCell className="tabular-nums">{duration ?? <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-xs" title={userAgent ?? undefined}>
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
          <nav className="flex items-center justify-end gap-2" aria-label="Ping history pages">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(page - 1)} disabled={page <= 1 || isLoading} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages || isLoading} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

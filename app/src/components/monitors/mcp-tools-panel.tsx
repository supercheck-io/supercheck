"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertCircle, ChevronRight, Plug } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBadge } from "@/components/ui/table-badge";
import type { McpMonitorState, McpToolChange } from "@/db/schema/types";

const DAY_MS = 24 * 60 * 60 * 1000;

interface McpToolsPanelProps {
  baseline?: McpMonitorState["baseline"];
  /** Stored oldest first (newest last); shown newest first. */
  changes?: McpToolChange[];
  /** No check has run yet. */
  pending?: boolean;
  /** Failure line of the latest check when it is down. */
  failure?: string | null;
  /** Injected for tests. */
  now?: number;
}

function formatAt(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : format(date, "MMM d, yyyy HH:mm");
}

/** Tool names come from the customer's server, so every name is rendered as plain text. */
function NameList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {names.map((name) => (
          <li key={name} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs break-all">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangeRow({ change, index }: { change: McpToolChange; index: number }) {
  const [open, setOpen] = useState(false);
  const panelId = `mcp-change-${index}`;
  const parts = [
    change.added.length ? `+${change.added.length} added` : null,
    change.removed.length ? `-${change.removed.length} removed` : null,
    change.changed.length ? `~${change.changed.length} changed` : null,
    change.beyondStored ? "changed beyond the first 500 tools" : null,
  ].filter(Boolean);
  return (
    <li className="py-2" data-testid="mcp-change">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span className="text-muted-foreground">{formatAt(change.at)}</span>
        <span className="font-medium">{parts.join(", ") || "No difference recorded"}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-2 space-y-2 pl-6" data-testid="mcp-change-detail">
          <NameList label="Added" names={change.added} />
          <NameList label="Removed" names={change.removed} />
          {change.changed.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Changed</p>
              <ul className="mt-1 space-y-1">
                {change.changed.map((item) => (
                  <li key={item.name} className="text-xs">
                    <span className="rounded-md bg-muted px-2 py-0.5 font-mono break-all">{item.name}</span>{" "}
                    <span className="text-muted-foreground">{item.reasons.map((r) => (r === "schema" ? "input schema" : r)).join(" and ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function McpToolsPanel({ baseline, changes, pending = false, failure, now }: McpToolsPanelProps) {
  const [mountedAt] = useState(() => Date.now());
  const tools = baseline?.tools ?? [];
  const newestFirst = [...(changes ?? [])].reverse();
  const newestAt = newestFirst.length ? new Date(newestFirst[0].at).getTime() : NaN;
  const recentChange = Number.isFinite(newestAt) && (now ?? mountedAt) - newestAt < DAY_MS;

  return (
    <Card className="shadow-sm" data-testid="mcp-tools-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Plug className="h-4 w-4 text-type-orchid" aria-hidden />
          Tools
          {baseline && (
            <span className="text-sm font-normal text-muted-foreground" data-testid="mcp-tool-count">
              {tools.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {failure && (
          <Alert variant="error" data-testid="mcp-failure">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        {pending && !baseline && !failure ? (
          <p className="text-sm text-muted-foreground" data-testid="mcp-pending">Waiting for the first check</p>
        ) : baseline && tools.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="mcp-no-tools">This server lists no tools</p>
        ) : tools.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tools on the server" data-testid="mcp-tool-list">
            {tools.map((tool) => (
              <li key={tool.name} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs break-all">
                {tool.name}
              </li>
            ))}
          </ul>
        ) : null}

        {newestFirst.length > 0 && (
          <section aria-labelledby="mcp-changes-heading">
            <div className="flex items-center gap-2">
              <h3 id="mcp-changes-heading" className="text-sm font-semibold">Changes</h3>
              {recentChange && (
                <TableBadge tone="warning" compact data-testid="mcp-tools-changed-badge">
                  Tools changed
                </TableBadge>
              )}
            </div>
            <ul className="mt-1 divide-y divide-border">
              {newestFirst.map((change, index) => (
                <ChangeRow key={`${change.at}-${index}`} change={change} index={index} />
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

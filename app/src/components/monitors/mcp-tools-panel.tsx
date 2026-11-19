"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, ChevronRight, Plug } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  /** Server name, version and protocol of the latest check, shown as muted text in the header. */
  meta?: string | null;
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

/** True when the newest tool change is under a day old. */
function useRecentChange(changes: McpToolChange[] | undefined, now: number | undefined) {
  const [clock, setClock] = useState(() => Date.now());
  const newest = changes?.length ? new Date(changes[changes.length - 1].at).getTime() : NaN;
  const recent = Number.isFinite(newest) && (now ?? clock) - newest < DAY_MS;
  // Re-render when the "Changed" flag expires, so a long-open page does not keep showing it.
  useEffect(() => {
    if (now !== undefined || !recent) return;
    const timer = setTimeout(() => setClock(Date.now()), newest + DAY_MS - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [now, recent, newest]);
  return recent;
}

/** The tool list, server identity and change history of an MCP server; shown in the Tools popover. */
export function McpToolsPanel({ baseline, changes, pending = false, failure, meta, now }: McpToolsPanelProps) {
  const tools = baseline?.tools ?? [];
  const newestFirst = [...(changes ?? [])].reverse();
  const recentChange = useRecentChange(changes, now);

  return (
    <div className="space-y-3" data-testid="mcp-tools-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        <Plug className="h-4 w-4 text-type-purple" aria-hidden />
        Tools
        {baseline && (
          <span className="font-normal text-muted-foreground" data-testid="mcp-tool-count">
            {tools.length}
          </span>
        )}
        {meta && (
          <span className="min-w-0 break-words text-xs font-normal text-muted-foreground" data-testid="mcp-server-meta">
            {meta}
          </span>
        )}
      </div>
      <div className="space-y-4">
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
          <ul className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto" aria-label="Tools on the server" data-testid="mcp-tool-list">
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
      </div>
    </div>
  );
}

/**
 * "48 tools" button for the detail page: opens the tool list and change history, so they take no page height.
 * The button itself flags a failed check and a change under a day old.
 */
export function McpToolsButton(props: McpToolsPanelProps) {
  const { baseline, changes, failure, now } = props;
  const recentChange = useRecentChange(changes, now);
  const count = baseline?.tools.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" data-testid="mcp-tools-button">
          {failure ? (
            <AlertCircle className="h-4 w-4 text-failure" aria-hidden />
          ) : (
            <Plug className="h-4 w-4 text-type-purple" aria-hidden />
          )}
          {count === undefined ? "Tools" : `${count} ${count === 1 ? "tool" : "tools"}`}
          {failure && <span className="sr-only"> (latest check failed)</span>}
          {recentChange && (
            <TableBadge tone="warning" compact data-testid="mcp-tools-changed-indicator">
              Changed
            </TableBadge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(70vh,32rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto">
        <McpToolsPanel {...props} />
      </PopoverContent>
    </Popover>
  );
}

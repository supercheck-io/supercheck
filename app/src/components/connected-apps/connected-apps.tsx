"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { FolderOpen, Link2, RefreshCw, ShieldAlert, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { ListErrorState } from "@/components/shared/list-states";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { NAV } from "@/lib/nav-areas";
import { TableBadge } from "@/components/ui/table-badge";
import { TYPE_CHIP, type TypeTone } from "@/lib/type-tones";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Connection {
  id: string;
  clientName: string | null;
  verifiedHost: string | null;
  redirectHosts: string[];
  projectName: string | null;
  connectedAt: string;
  lastActiveAt: string | null;
}

type State =
  | { status: "loading" }
  | { status: "disabled" }
  | { status: "error" }
  | { status: "ready"; connections: Connection[] };

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 hours ago", with the exact time in a tooltip. */
function When({ value, fallback }: { value: string | null; fallback: string }) {
  const date = parseDate(value);
  if (!date) return <>{fallback}</>;
  return <time dateTime={date.toISOString()} title={date.toLocaleString()}>{formatDistanceToNow(date, { addSuffix: true })}</time>;
}

// App tiles (a DESIGN.md exception): no status hues, and not orchid (this page) or sky (Dashboard).
const MONOGRAM_TONES: TypeTone[] = ["teal", "cobalt", "aqua", "lime", "clay", "olive"];

/** Same app name, same colour, on every load. */
function monogramTone(name: string): TypeTone {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MONOGRAM_TONES[hash % MONOGRAM_TONES.length];
}

/** `page` fills the Connected apps page; `panel` is the compact version in the account dialog. */
export function ConnectedApps({ variant = "panel" }: { variant?: "page" | "panel" }) {
  const emptyClass = variant === "page" ? "min-h-[420px]" : "min-h-[220px]";
  const EmptyIcon = NAV.connectedApps.icon;
  const [state, setState] = useState<State>({ status: "loading" });
  const [pending, setPending] = useState<Connection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth/mcp/connections", { cache: "no-store" });
      if (response.status === 404) return setState({ status: "disabled" });
      if (!response.ok) return setState({ status: "error" });
      const body = (await response.json()) as { connections: Connection[] };
      setState({ status: "ready", connections: body.connections });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(connection: Connection) {
    setDisconnecting(true);
    try {
      const response = await fetch(`/api/oauth/mcp/connections/${connection.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error("failed");
      toast.success(`Disconnected ${connection.clientName ?? "the app"}`);
      setPending(null);
      await load();
    } catch {
      toast.error("Could not disconnect. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className={`flex items-center justify-center ${emptyClass}`}>
        <SupercheckLoading size="md" message="Loading connected apps..." />
      </div>
    );
  }
  if (state.status === "disabled") {
    return (
      <DashboardEmptyState
        className={emptyClass}
        title="Connected apps are off"
        description="Connecting apps is not enabled on this server. An administrator can turn on the MCP server to let AI agents read a project."
        icon={<EmptyIcon className="h-10 w-10" />}
      />
    );
  }
  if (state.status === "error") {
    return <ListErrorState title="Could not load your connected apps" onRetry={() => void load()} />;
  }
  if (!state.connections.length) {
    return (
      <DashboardEmptyState
        className={emptyClass}
        title="No connected apps"
        description="Add Supercheck as an MCP server in your AI tool and approve it here when asked."
        icon={<EmptyIcon className="h-10 w-10" />}
        action={
          <Button asChild variant="outline">
            <a href="https://supercheck.io/docs/mcp" target="_blank" rel="noreferrer">Set up MCP</a>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {state.connections.length} {state.connections.length === 1 ? "app" : "apps"} connected
      </p>
      <ul className="@container grid gap-3">
        {state.connections.map((connection) => {
          const name = connection.clientName ?? "Unnamed app";
          const host = connection.verifiedHost ?? connection.redirectHosts.join(", ");
          return (
            <li
              key={connection.id}
              className="flex flex-col gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20 @md:flex-row @md:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  aria-hidden
                  className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold", TYPE_CHIP[monogramTone(name)])}
                >
                  {[...name.trim()][0]?.toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate font-medium leading-tight" title={name}>{name}</p>
                    {connection.verifiedHost ? (
                      <TableBadge tone="success" compact className="gap-1"><ShieldCheck className="size-3.5" aria-hidden />Verified</TableBadge>
                    ) : (
                      <TableBadge tone="warning" compact className="gap-1"><ShieldAlert className="size-3.5" aria-hidden />Unverified</TableBadge>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={host}>
                    {connection.verifiedHost ? host : `Returns to ${host || "unknown"}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <FolderOpen className="size-3.5 shrink-0" aria-hidden />
                      Can read
                      <span className="truncate font-medium text-foreground">{connection.projectName ?? "a project you can no longer access"}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Link2 className="size-3.5 shrink-0" aria-hidden />
                      Connected <When value={connection.connectedAt} fallback="at an unknown time" />
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <RefreshCw className="size-3.5 shrink-0" aria-hidden />
                      Last refreshed <When value={connection.lastActiveAt} fallback="never" />
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="self-start @md:self-center"
                aria-label={`Disconnect ${name}`}
                onClick={() => setPending(connection)}
              >
                <Unplug aria-hidden />
                Disconnect
              </Button>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !disconnecting && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {pending?.clientName ?? "this app"}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses access to {pending?.projectName ?? "that project"} immediately, including with a token it
              already holds. You can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnecting}
              onClick={(event) => {
                event.preventDefault();
                if (pending) void disconnect(pending);
              }}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

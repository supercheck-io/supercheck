"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export function ConnectedApps() {
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
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (state.status === "disabled") {
    return <p className="text-sm text-muted-foreground">Connecting apps is not enabled on this server.</p>;
  }
  if (state.status === "error") {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">Could not load your connected apps.</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
      </div>
    );
  }
  if (!state.connections.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No apps are connected. Add Supercheck as an MCP server in your AI tool and approve it here when asked.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-md border">
        {state.connections.map((connection) => (
          <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium">{connection.clientName ?? "Unnamed app"}</p>
              <p className="text-sm text-muted-foreground">
                {connection.verifiedHost
                  ? `Metadata hosted at ${connection.verifiedHost}`
                  : `Unverified (returns to ${connection.redirectHosts.join(", ") || "unknown"})`}
              </p>
              <p className="text-sm text-muted-foreground">
                Can read <span className="font-medium text-foreground">{connection.projectName ?? "a project you can no longer access"}</span>
                {" · "}Connected {formatDate(connection.connectedAt)}
                {" · "}Last refreshed {formatDate(connection.lastActiveAt)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPending(connection)}>
              Disconnect
            </Button>
          </li>
        ))}
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

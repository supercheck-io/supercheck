"use client";

import React, { useEffect, useState } from "react";
import { Copy, Eye, Link2, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoPopover } from "@/components/ui/info-popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/**
 * The full ping URL is returned once, by the create call. It is handed to the detail page in memory
 * only (never sessionStorage or the persisted query cache), so a reload falls back to Reveal.
 */
const createdPingUrls = new Map<string, string>();

export function rememberCreatedPingUrl(monitorId: unknown, pingUrl: unknown) {
  if (typeof monitorId === "string" && typeof pingUrl === "string" && pingUrl) createdPingUrls.set(monitorId, pingUrl);
}

function takeCreatedPingUrl(monitorId: string): string | null {
  const url = createdPingUrls.get(monitorId) ?? null;
  createdPingUrls.delete(monitorId);
  return url;
}

const MASK = "•".repeat(28);

const RETRY = "curl -fsS -m 10 --retry 5";

export function pingSnippets(url: string) {
  return {
    curl: `${RETRY} ${url}`,
    cron: `# Ping only when the job succeeds\n0 2 * * * /usr/local/bin/backup.sh && ${RETRY} ${url}`,
    cli: `supercheck heartbeat ping ${url}\n# Add --start when the job begins, --fail to report a failure`,
  };
}

type SnippetKey = keyof ReturnType<typeof pingSnippets>;

async function requestPingUrl(monitorId: string, rotate: boolean): Promise<string> {
  const response = await fetch(`/api/monitors/${monitorId}/heartbeat-url${rotate ? "/rotate" : ""}`, {
    method: rotate ? "POST" : "GET",
    cache: "no-store",
  });
  if (response.status === 429) throw new Error("Too many requests. Try again in a few minutes.");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : "Could not load the ping URL.");
  }
  const body = (await response.json()) as { pingUrl?: unknown };
  if (typeof body.pingUrl !== "string") throw new Error("Could not load the ping URL.");
  return body.pingUrl;
}

interface HeartbeatPingUrlPanelProps {
  monitorId: string;
  /** Editors and above (monitor:update). Viewers see the masked URL and no buttons. */
  canManage: boolean;
  /** Never pinged yet: show the "waiting" empty state above the snippets. */
  pending?: boolean;
}

export function HeartbeatPingUrlPanel({ monitorId, canManage, pending = false }: HeartbeatPingUrlPanelProps) {
  const [pingUrl, setPingUrl] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<"reveal" | "copy" | "rotate" | null>(null);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [snippetTab, setSnippetTab] = useState<SnippetKey>("curl");

  useEffect(() => {
    setOrigin(window.location.origin);
    const created = takeCreatedPingUrl(monitorId);
    if (created) setPingUrl(created);
  }, [monitorId]);

  // Viewers and editors before Reveal see a placeholder built from this app's origin.
  const shownUrl = pingUrl ?? (origin ? `${origin}/api/heartbeat/hb_${MASK}` : `/api/heartbeat/hb_${MASK}`);
  const snippets = pingSnippets(shownUrl);

  async function load(action: "reveal" | "copy" | "rotate"): Promise<string | null> {
    setBusy(action);
    setError(null);
    try {
      const url = await requestPingUrl(monitorId, action === "rotate");
      setPingUrl(url);
      return url;
    } catch (err) {
      // Rotating again is destructive, so a failed rotate asks again instead of retrying silently.
      setError({
        message: err instanceof Error ? err.message : "Could not load the ping URL.",
        retry: action === "rotate" ? () => setConfirmRotate(true) : () => void load(action),
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    const url = pingUrl ?? (await load("copy"));
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ping URL copied");
    } catch {
      toast.error("Could not copy. Reveal the URL and copy it by hand.");
    }
  }

  async function rotate() {
    setConfirmRotate(false);
    if (await load("rotate")) toast.success("Ping URL rotated. Update your job with the new URL.");
  }

  async function copySnippet() {
    const url = pingUrl ?? (await load("copy"));
    if (!url) return;
    try {
      await navigator.clipboard.writeText(pingSnippets(url)[snippetTab]);
      toast.success("Command copied");
    } catch {
      toast.error("Could not copy. Reveal the URL and copy it by hand.");
    }
  }

  const spin = (action: "reveal" | "copy" | "rotate", icon: React.ReactNode) =>
    busy === action ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : icon;

  return (
    <Card className="shrink-0 shadow-sm" data-testid="heartbeat-ping-url-panel">
      <CardContent className="grid gap-5 p-5">
        <div className="min-w-0 space-y-3">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Ping URL
              </h2>
              <InfoPopover
                label="About the ping URL"
                title="Ping URL"
                description="Your job calls this URL each time it finishes. GET, POST and HEAD all work."
                bullets={[
                  "Call /start when the job begins to record how long it ran.",
                  "Call /fail to report a failure straight away.",
                ]}
                learnMoreHref="https://supercheck.io/docs/app/heartbeat"
              />
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-1">
                {!pingUrl && (
                  <Button variant="outline" size="sm" className="h-8" onClick={() => void load("reveal")} disabled={busy !== null} data-testid="heartbeat-reveal">
                    {spin("reveal", <Eye className="mr-1 h-4 w-4" />)}
                    Reveal
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-8" onClick={() => void copy()} disabled={busy !== null} data-testid="heartbeat-copy">
                  {spin("copy", <Copy className="mr-1 h-4 w-4" />)}
                  Copy
                </Button>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setConfirmRotate(true)} disabled={busy !== null} data-testid="heartbeat-rotate">
                  {spin("rotate", <RotateCw className="mr-1 h-4 w-4" />)}
                  Rotate URL
                </Button>
              </div>
            )}
          </div>
          {!pingUrl && <span className="sr-only">Ping URL hidden.</span>}
          <code
            className="block break-all rounded-md border bg-muted/40 px-3.5 py-2.5 font-mono text-xs lg:truncate"
            aria-hidden={pingUrl ? undefined : true}
            data-testid="heartbeat-ping-url"
            data-revealed={pingUrl ? "true" : "false"}
          >
            {shownUrl}
          </code>
          {error && (
            <Alert variant="error" data-testid="heartbeat-ping-url-error">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {error.message}
                <Button variant="ghost" size="sm" onClick={error.retry}>
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <Tabs value={snippetTab} onValueChange={(v) => setSnippetTab(v as SnippetKey)} className="min-w-0 gap-3">
          <div className="flex min-h-8 items-center justify-between gap-2">
            <TabsList aria-label="Ping snippets" className="h-8">
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="cron">cron</TabsTrigger>
              <TabsTrigger value="cli">CLI</TabsTrigger>
            </TabsList>
            {canManage && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void copySnippet()} disabled={busy !== null} aria-label="Copy command" data-testid="heartbeat-snippet-copy">
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
          {(Object.keys(snippets) as SnippetKey[]).map((key) => (
            <TabsContent key={key} value={key} className="mt-0">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 px-3.5 py-3 font-mono text-xs leading-relaxed" data-testid={`heartbeat-snippet-${key}`}>
                {snippets[key]}
              </pre>
            </TabsContent>
          ))}
        </Tabs>

        {pending && (
          <p role="status" className="flex items-center gap-1.5 text-xs font-medium" data-testid="heartbeat-waiting">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
            Waiting for the first ping. The monitor turns Up when it arrives.
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the ping URL?</AlertDialogTitle>
            <AlertDialogDescription>
              The old URL stops working at once. Update your job before you rotate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotate()} data-testid="heartbeat-rotate-confirm">
              Rotate URL
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TableBadge } from "@/components/ui/table-badge";
import { PAGING_SERVICE_NAMES } from "./data";
import type { NotificationChannel } from "./notification-channels-schema";

export type ChannelTestResult = {
  ok: boolean;
  action: "trigger" | "resolve";
  responseStatus?: number;
  responseStatusText?: string;
  responseExcerpt?: string;
  elapsedMs?: number;
  dedupKey?: string;
  message?: string;
  error?: string;
};

export async function sendChannelTest(channelId: string, action: "trigger" | "resolve"): Promise<ChannelTestResult> {
  const response = await fetch(`/api/notification-providers/${encodeURIComponent(channelId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<ChannelTestResult> & { error?: string };
  // 403/404/429 carry only { error }; the send itself answers 200 with ok true or false.
  if (!response.ok) return { ok: false, action, error: body.error ?? `Request failed (HTTP ${response.status})` };
  return { ok: body.ok === true, action, ...body } as ChannelTestResult;
}

/** Sends a test through a saved channel and shows what the receiver answered. Opens with a send already started. */
export function ChannelTestDialog({ channel, onOpenChange }: { channel: NotificationChannel | null; onOpenChange: (open: boolean) => void }) {
  const [result, setResult] = useState<ChannelTestResult | null>(null);
  const [pending, setPending] = useState<"trigger" | "resolve" | null>(null);

  const preset = typeof channel?.config?.preset === "string" ? channel.config.preset : "custom";
  const isWebhook = channel?.type === "webhook";
  const isPreset = isWebhook && preset !== "custom";
  const noun = isWebhook ? "page" : "message";

  const run = async (action: "trigger" | "resolve") => {
    if (!channel) return;
    setPending(action);
    try {
      setResult(await sendChannelTest(channel.id, action));
    } catch {
      setResult({ ok: false, action, error: "The test could not be sent" });
    } finally {
      setPending(null);
    }
  };

  // Opening the dialog sends the first test; only a different channel starts a new one.
  const channelId = channel?.id ?? null;
  useEffect(() => {
    setResult(null);
    if (!channelId) return;
    let cancelled = false;
    setPending("trigger");
    sendChannelTest(channelId, "trigger")
      .catch((): ChannelTestResult => ({ ok: false, action: "trigger", error: "The test could not be sent" }))
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .finally(() => {
        if (!cancelled) setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const authFailed = result?.responseStatus === 401 || result?.responseStatus === 403;

  return (
    <Dialog open={channel !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="channel-test-dialog">
        <DialogHeader>
          <DialogTitle>{`Test ${noun}: ${channel?.name ?? ""}`}</DialogTitle>
          <DialogDescription>
            {isPreset
              ? `Sent to ${PAGING_SERVICE_NAMES[preset] ?? "the paging service"} with the channel's saved settings.`
              : "Sent with the channel's saved settings."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm" aria-live="polite">
          {pending && !result && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Sending test {noun}…
            </div>
          )}
          {result && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <TableBadge tone={result.ok ? "success" : authFailed ? "danger" : "warning"} data-testid="channel-test-status">
                  {result.ok ? (result.action === "resolve" ? "Resolved" : "Delivered") : "Failed"}
                </TableBadge>
                {result.responseStatus !== undefined && (
                  <span>
                    HTTP {result.responseStatus}
                    {result.responseStatusText ? ` ${result.responseStatusText}` : ""}
                  </span>
                )}
                {result.elapsedMs !== undefined && <span className="text-muted-foreground">{result.elapsedMs} ms</span>}
              </div>
              {(result.error || result.message) && (
                <p className={result.ok ? "text-muted-foreground" : "text-destructive"} data-testid="channel-test-error">
                  {result.error ?? result.message}
                </p>
              )}
              {result.dedupKey && (
                <p className="text-muted-foreground">
                  Dedup key <code className="rounded bg-muted px-1 py-0.5">{result.dedupKey}</code>
                </p>
              )}
              {result.responseExcerpt && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Response (first 1,024 characters)</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-2 text-xs">{result.responseExcerpt}</pre>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {isPreset && (
            <Button variant="outline" onClick={() => void run("resolve")} disabled={pending !== null || !result?.ok || result.action === "resolve"}>
              {pending === "resolve" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Resolve test page
            </Button>
          )}
          <Button variant="outline" onClick={() => void run("trigger")} disabled={pending !== null}>
            Send again
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import type { ScanSummary } from "@/lib/setup/scan";
import { fetchJson, postJson, responseError, scanMatchesUrl } from "./step-types";

export const SCAN_POLL_MS = 2000;
// Longer than the 60 s scan budget: a scan can wait in the queue behind others before it runs.
export const SCAN_MAX_MS = 300_000;

export type ScanPhase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "done"; result: ScanSummary; url?: string }
  | { kind: "error"; message: string };

const SCAN_ERRORS: Record<NonNullable<ScanSummary["error"]> | "timeout" | "unavailable" | "failed", string> = {
  blocked_private: "This address is private. Scans only reach public websites, so enter a public address or skip the scan.",
  bot_protection: "The site answered with a bot-protection page, so we could not read it. You can still add monitors by hand.",
  unreachable: "We could not reach this address. Check the URL, or continue and add monitors by hand.",
  timeout: "The scan took too long and was stopped. Try again, or continue without it.",
  ssl_invalid: "The SSL certificate is invalid or expired.",
  too_many_redirects: "The address redirected too many times. Check the URL, or continue without a scan.",
  unavailable: "Scan unavailable, continue without it.",
  failed: "The scan failed. Try again, or continue without it.",
};

/** Starts a scan and polls it every 2 s until it finishes, 5 min pass, or the component unmounts. */
export function useScan(projectId: string, onResult: (result: ScanSummary) => void) {
  const [phase, setPhase] = useState<ScanPhase>({ kind: "idle" });
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const run = useRef(0);

  const stopRun = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (deadline.current) clearTimeout(deadline.current);
    controller.current?.abort();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopRun();
    };
  }, [stopRun]);

  const start = useCallback(
    async (url: string) => {
      const id = ++run.current;
      const current = () => alive.current && run.current === id;
      stopRun();
      const abort = new AbortController();
      controller.current = abort;
      // Independent of the requests, so a hung POST or poll cannot keep the panel scanning past the cap.
      deadline.current = setTimeout(() => {
        if (!current()) return;
        run.current++;
        abort.abort();
        setPhase({ kind: "error", message: SCAN_ERRORS.timeout });
      }, SCAN_MAX_MS);
      setPhase({ kind: "scanning" });
      const fail = (message: string) => {
        if (!current()) return;
        stopRun();
        setPhase({ kind: "error", message });
      };
      const base = `/api/projects/${projectId}/setup/scan`;
      let res;
      try {
        res = await postJson<{ scanId?: string; details?: unknown }>(base, { url }, undefined, abort.signal);
      } catch {
        return fail(SCAN_ERRORS.unavailable);
      }
      if (!current()) return;
      const scanId = res.data.scanId;
      if (!res.ok || !scanId) {
        if (res.status === 503) return fail(SCAN_ERRORS.unavailable);
        // The app-side target policy answers 400 with `details` for private and blocked addresses.
        if (res.status === 400 && res.data.details) return fail(SCAN_ERRORS.blocked_private);
        return fail(responseError(res.data, SCAN_ERRORS.failed));
      }
      const poll = async () => {
        if (!current()) return;
        let body: { status?: string; result?: ScanSummary } = {};
        let ok = false;
        try {
          const polled = await fetchJson(`${base}?scanId=${encodeURIComponent(scanId)}`, { signal: abort.signal });
          ok = polled.ok;
          body = polled.data as typeof body;
        } catch {
          ok = false;
        }
        if (!current()) return;
        if (!ok) return fail(SCAN_ERRORS.unavailable);
        if (body.status === "done" && body.result) {
          stopRun();
          setPhase({ kind: "done", result: body.result, url });
          onResult(body.result);
          return;
        }
        if (body.status === "failed") return fail(SCAN_ERRORS.failed);
        if (body.status === "unavailable") return fail(SCAN_ERRORS.unavailable);
        timer.current = setTimeout(poll, SCAN_POLL_MS);
      };
      timer.current = setTimeout(poll, SCAN_POLL_MS);
    },
    [projectId, onResult, stopRun],
  );

  return { phase, start };
}

const ms = (value: number | null) => (value === null ? "n/a" : `${Math.round(value)} ms`);

/** Rows of the findings table: label, badge tone and word, and the detail text. */
export function scanFindings(result: ScanSummary): Array<{ label: string; tone: TableBadgeTone; word: string; detail: string }> {
  const days = result.ssl?.daysRemaining;
  return [
    {
      label: "Reachable",
      tone: result.reachable ? "success" : "danger",
      word: result.reachable ? "Reachable" : "Not reachable",
      detail: result.status === null ? "No response" : `${result.status} in ${ms(result.responseMs)}`,
    },
    {
      label: "Redirects",
      tone: result.redirects <= 2 ? "success" : "warning",
      word: result.redirects === 0 ? "None" : result.redirects <= 2 ? "OK" : "Many",
      detail: result.redirects === 0 ? "No redirects" : `${result.redirects} ${result.redirects === 1 ? "hop" : "hops"} to ${result.finalUrl}`,
    },
    {
      label: "SSL certificate",
      tone: days === undefined ? "neutral" : days < 7 ? "danger" : days < 30 ? "warning" : "success",
      word: days === undefined ? "None found" : days < 0 ? "Expired" : days < 7 ? "Expiring" : days < 30 ? "Soon" : "Valid",
      detail: days === undefined ? "No certificate was read" : `${days} days left`,
    },
    {
      label: "Response time",
      tone: result.responseMs === null ? "neutral" : result.responseMs < 1000 ? "success" : result.responseMs < 3000 ? "warning" : "danger",
      word: result.responseMs === null ? "Unknown" : result.responseMs < 1000 ? "Fast" : result.responseMs < 3000 ? "Slow" : "Very slow",
      detail: ms(result.responseMs),
    },
    {
      label: "Pages found",
      tone: result.pages.length > 0 ? "info" : "neutral",
      word: String(result.pages.length),
      detail: result.pages.length > 0 ? "Suggested as monitors in the next steps" : "None found on the homepage",
    },
  ];
}

export function ScanFindings({ result }: { result: ScanSummary }) {
  if (result.error) {
    const expiry = result.error === "ssl_invalid" ? Date.parse(result.ssl?.validTo ?? "") : NaN;
    const message = Number.isNaN(expiry)
      ? SCAN_ERRORS[result.error]
      : `The SSL certificate is invalid or expired (${new Date(expiry).toISOString().slice(0, 10)}).`;
    return <Alert variant="error">{message}</Alert>;
  }
  return (
    <Table data-testid="setup-scan-findings">
      <TableHeader>
        <TableRow>
          <TableHead>Check</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scanFindings(result).map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell>
              <TableBadge tone={row.tone} compact>
                {row.word}
              </TableBadge>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.detail}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScanPanel({ projectId, url, disabled, onResult, initial }: { projectId: string; url: string | null; disabled: boolean; onResult: (result: ScanSummary) => void; initial: ScanSummary | null }) {
  const { phase, start } = useScan(projectId, onResult);
  const current: ScanPhase = phase.kind === "idle" && initial ? { kind: "done", result: initial } : phase;
  // A finished scan belongs to the address it ran against; hide it once the URL points elsewhere. A run is compared
  // with the URL it was submitted for (a redirect to another domain changes finalUrl); a stored scan, by its final host.
  const matches = current.kind === "done" && (current.url !== undefined ? current.url === url : scanMatchesUrl(current.result, url));
  const shown: ScanPhase = current.kind === "done" && !matches ? { kind: "idle" } : current;
  const scanning = phase.kind === "scanning";
  return (
    <section aria-labelledby="setup-scan" className="space-y-3" data-testid="setup-scan">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="setup-scan" className="text-sm font-semibold">
            Scan your app <span className="font-normal text-muted-foreground">(optional)</span>
          </h3>
          <p className="text-xs text-muted-foreground">We look at the homepage and a few pages to suggest monitors. Nothing is stored except codes, timings and page paths.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled || !url || scanning} onClick={() => url && void start(url)}>
          {scanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {scanning ? "Scanning..." : shown.kind === "idle" ? "Scan" : "Scan again"}
        </Button>
      </div>
      <div aria-live="polite">
        {scanning ? <p className="text-sm text-muted-foreground">Scanning {url}. This usually takes under a minute.</p> : null}
        {shown.kind === "error" ? <Alert variant="error">{shown.message}</Alert> : null}
        {shown.kind === "done" ? <ScanFindings result={shown.result} /> : null}
      </div>
    </section>
  );
}

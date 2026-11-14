"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { primaryButton, secondaryButton } from "../landing/buttons";
import {
  CHECKS_API_URL,
  TOOLS_SITE_KEY,
  invalidMessage,
  monitorThisHref,
  shareHref,
  toState,
  type CheckState,
  type ToolId,
} from "../../lib/tools-funnel";
import { ToolResult } from "./results";

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"))));
    script.addEventListener("error", () => reject(new Error("turnstile")));
  });
}

type Phase = { kind: "idle" } | { kind: "verifying" } | { kind: "running" } | CheckState;

export interface CheckerProps {
  tool: ToolId;
  slug: string;
  input: "url" | "domain";
  placeholder: string;
  submitLabel: string;
  ctaTitle: string;
  ctaBody: string;
}

export function Checker({ tool, slug, input, placeholder, submitLabel, ctaTitle, ctaBody }: CheckerProps) {
  const [method, setMethod] = useState<"GET" | "HEAD">("GET");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [checked, setChecked] = useState<{ value: string; method: "GET" | "HEAD" } | null>(null);
  const [copied, setCopied] = useState(false);
  const inputEl = useRef<HTMLInputElement>(null);
  const widgetEl = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const pending = useRef<((token: string | null) => void) | null>(null);
  const inputId = useId();
  const errorId = useId();
  const configured = Boolean(CHECKS_API_URL && TOOLS_SITE_KEY);

  // Share links pre-fill the form; they never run a check on their own.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get(input === "domain" ? "domain" : "url");
    if (shared && inputEl.current) inputEl.current.value = shared.slice(0, 2048);
  }, [input]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !widgetEl.current || widgetId.current) return;
        widgetId.current = ts.render(widgetEl.current, {
          sitekey: TOOLS_SITE_KEY,
          action: tool,
          execution: "execute",
          appearance: "interaction-only",
          callback: (token: string) => pending.current?.(token),
          "error-callback": () => pending.current?.(null),
          "expired-callback": () => pending.current?.(null),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [configured, tool]);

  const getToken = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        const ts = window.turnstile;
        if (!ts || !widgetId.current) return resolve(null);
        pending.current = (token) => {
          pending.current = null;
          resolve(token);
        };
        ts.execute(widgetId.current);
      }),
    [],
  );

  const run = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = (inputEl.current?.value ?? "").trim();
      if (!trimmed) {
        setPhase({ kind: "invalid", reason: "missing_input" });
        return;
      }
      setCopied(false);
      setPhase({ kind: "verifying" });
      const token = await getToken();
      if (!token) {
        setPhase({ kind: "captcha" });
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
        return;
      }
      setPhase({ kind: "running" });
      let next: CheckState;
      try {
        // text/plain keeps this a CORS simple request: one Worker call, no preflight.
        const res = await fetch(`${CHECKS_API_URL.replace(/\/$/, "")}/v1/check`, {
          method: "POST",
          credentials: "omit",
          headers: { "content-type": "text/plain" },
          body: JSON.stringify({ tool, input: trimmed, token, ...(tool === "api" ? { method } : {}) }),
        });
        const body = await res.json().catch(() => null);
        next = toState(res.status, body);
      } catch {
        next = { kind: "busy" };
      }
      setChecked({ value: trimmed, method });
      setPhase(next);
      // Tokens are single use.
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    },
    [getToken, method, tool],
  );

  const busy = phase.kind === "verifying" || phase.kind === "running";
  const share = checked ? shareHref(slug, tool, checked.value) : null;
  const monitorHref = monitorThisHref(tool, checked?.value ?? "", checked?.method ?? method);

  if (!configured) {
    return (
      <div data-testid="tool-unconfigured" className="rounded-xl border border-fd-border bg-fd-card p-6">
        <p className="font-medium">This check runs in Supercheck.</p>
        <p className="mt-1 text-sm text-fd-muted-foreground">The free checker isn&apos;t available on this site. The method below shows what it looks at.</p>
        <a href={monitorThisHref(tool, "")} className={`${secondaryButton} mt-4`}>
          Try it in Supercheck
        </a>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={run} noValidate className="rounded-xl border border-fd-border bg-fd-card p-4 sm:p-6" data-testid="tool-form">
        <label htmlFor={inputId} className="text-sm font-medium">
          {input === "domain" ? "Domain" : "Page URL"}
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          {tool === "api" && (
            <select
              aria-label="Method"
              value={method}
              onChange={(e) => setMethod(e.target.value as "GET" | "HEAD")}
              className="rounded-md border border-fd-border bg-fd-background px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-fd-primary"
            >
              <option>GET</option>
              <option>HEAD</option>
            </select>
          )}
          <input
            id={inputId}
            name={input}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            placeholder={placeholder}
            ref={inputEl}
            aria-invalid={phase.kind === "invalid"}
            aria-describedby={phase.kind === "invalid" ? errorId : undefined}
            className="min-w-0 flex-1 rounded-md border border-fd-border bg-fd-background px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-fd-primary"
          />
          <button type="submit" disabled={busy} className={`${primaryButton} disabled:opacity-60`}>
            {busy && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {busy ? "Checking…" : submitLabel}
          </button>
        </div>
        {phase.kind === "invalid" && (
          <p id={errorId} className="mt-2 text-sm text-failure" data-testid="tool-invalid">
            {invalidMessage(phase.reason)}
          </p>
        )}
        <div ref={widgetEl} className="mt-3" />
        <p className="mt-3 text-xs text-fd-muted-foreground">
          One request from Cloudflare&apos;s edge, usually the data center nearest you. No account. Results may be cached for 10 minutes.{" "}
          <Link href="/tools/bot" className="text-fd-primary hover:underline">
            About SupercheckBot
          </Link>
        </p>
      </form>

      <div aria-live="polite" className="mt-6" data-testid="tool-status">
        {phase.kind === "captcha" && <Notice>We couldn&apos;t verify you&apos;re human. Try again; the check has been reset.</Notice>}
        {phase.kind === "rate_limited" && (
          <Notice>
            You&apos;ve run several checks in a minute. Try again in {phase.retryAfter} seconds, or{" "}
            <a href={monitorHref} className="text-fd-primary hover:underline">
              monitor the site
            </a>{" "}
            and it runs on a schedule.
          </Notice>
        )}
        {phase.kind === "disabled" && <Notice>This tool is paused. Other tools still work.</Notice>}
        {phase.kind === "busy" && (
          <Notice>
            The free tools are busy right now. Try again later, or{" "}
            <a href={monitorHref} className="text-fd-primary hover:underline">
              monitor the site in Supercheck
            </a>
            .
          </Notice>
        )}
        {phase.kind === "result" && checked && (
          <div className="rounded-xl border border-fd-border bg-fd-background" data-testid="tool-result">
            <ToolResult tool={tool} result={phase.result} />
            <div className="flex flex-col gap-3 border-t border-fd-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <p className="text-xs text-fd-muted-foreground" data-testid="tool-checked-from">
                {phase.colo ? `Checked from Cloudflare ${phase.colo}` : "Checked"} at {formatTime(phase.checkedAt)}
                {phase.cached ? " (cached result)" : ""}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {share && (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${window.location.origin}${share}`).then(() => setCopied(true));
                    }}
                  >
                    <Link2 className="size-4" aria-hidden="true" />
                    {copied ? "Link copied" : "Copy link"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {phase.kind === "result" && (
        <div className="mt-6 flex flex-col items-start gap-4 rounded-xl border border-fd-border bg-fd-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{ctaTitle}</p>
            <p className="mt-1 text-sm text-fd-muted-foreground">{ctaBody}</p>
          </div>
          <a href={monitorHref} className={primaryButton} data-testid="tool-monitor-this">
            Monitor this
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-fd-border bg-fd-card p-4 text-sm">{children}</p>;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

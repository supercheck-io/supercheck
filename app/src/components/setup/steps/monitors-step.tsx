"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AI_ENDPOINT_DEFAULT_URL } from "@/components/monitors/ai-endpoint-fields";
import {
  AI_ENDPOINT_QUERY_ALLOWLIST,
  MAX_DRAFT_BYTES,
  SETUP_LIMITS,
  aiEndpointUrlSchema,
  mcpUrlSchema,
  schemaError,
  secretNameSchema,
  setupModelSchema,
  setupNameSchema,
  setupUrlSchema,
  stripUrl,
  type SetupDraft,
} from "@/lib/setup/draft-schema";
import type { StepProps } from "./step-types";

const INTERVALS = [1, 5, 10, 15, 30, 60];

type Page = { url: string; name: string };
type MonitorsDraft = NonNullable<SetupDraft["monitors"]>;

function homepageOf(appUrl: string | undefined): Page | null {
  if (!appUrl) return null;
  const url = new URL(appUrl);
  return { url: `${url.origin}/`, name: url.host };
}

function pageFor(appUrl: string, path: string): Page | null {
  const base = new URL(appUrl);
  const clean = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
  const url = stripUrl(`${base.origin}${clean}`);
  return url ? { url, name: `${base.host}${new URL(url).pathname}` } : null;
}

/** Error for a page the server schema would reject (long path or name), else null. */
function pageError(page: Page): string | null {
  return schemaError(setupUrlSchema, page.url) ?? schemaError(setupNameSchema, page.name);
}

/** Inline error for a non-empty value that the draft schema rejects; empty shows nothing (the item is just not added). */
const fieldError = (schema: Parameters<typeof schemaError>[0], value: string) => (value.trim() === "" ? null : schemaError(schema, value));

function OptionalCard({
  id,
  title,
  description,
  enabled,
  disabled,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4" data-testid={`setup-card-${id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`setup-${id}-toggle`} className="text-sm font-semibold">
            {title}
          </Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch id={`setup-${id}-toggle`} checked={enabled} disabled={disabled} onCheckedChange={onToggle} />
      </div>
      {enabled ? <div className="mt-3 space-y-3">{children}</div> : null}
    </section>
  );
}

function Field({ id, label, help, error, ...props }: { id: string; label: string; help?: string; error?: boolean } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error} {...props} />
      {help ? <p className={error ? "text-xs text-failure" : "text-xs text-muted-foreground"}>{help}</p> : null}
    </div>
  );
}

export function MonitorsStep({ response, draft, patchDraft, features, readOnly }: StepProps) {
  const appUrl = draft.app?.url;
  const monitors: MonitorsDraft = draft.monitors ?? { pages: [] };
  const setMonitors = (next: Partial<MonitorsDraft>) => patchDraft((d) => ({ ...d, monitors: { pages: [], ...d.monitors, ...next } }));

  const home = homepageOf(appUrl);
  const homeUrl = home?.url;
  const homeName = home?.name;
  const untouched = !draft.monitors;
  // First visit: the homepage starts ticked, as the design suggests.
  useEffect(() => {
    if (untouched && homeUrl && homeName && !readOnly) {
      patchDraft((d) => ({ ...d, monitors: { pages: [{ url: homeUrl, name: homeName }], ...d.monitors } }));
    }
  }, [untouched, homeUrl, homeName, readOnly, patchDraft]);

  // The app URL changed after pages were suggested: move pages from the old address onto the new one.
  const appOrigin = appUrl ? new URL(appUrl).origin : null;
  const hasStalePages = Boolean(appOrigin) && monitors.pages.some((page) => new URL(page.url).origin !== appOrigin);
  useEffect(() => {
    if (!hasStalePages || !appUrl || !homeUrl || !homeName || readOnly) return;
    const origin = new URL(appUrl).origin;
    const moved = monitors.pages.flatMap((page) => {
      const parsed = new URL(page.url);
      if (parsed.origin === origin) return [page];
      // A page that cannot move to the new origin is dropped, so the effect cannot see it as stale again.
      const next = parsed.pathname === "/" ? { url: homeUrl, name: homeName } : pageFor(appUrl, parsed.pathname);
      return next ? [next] : [];
    });
    patchDraft((d) => ({ ...d, monitors: { ...d.monitors, pages: moved.filter((p, i) => moved.findIndex((q) => q.url === p.url) === i) } }));
  }, [hasStalePages, appUrl, homeUrl, homeName, readOnly, monitors.pages, patchDraft]);

  const extras = monitors.pages.filter((page) => page.url !== home?.url);
  const suggestions = [...(home ? [home] : []), ...extras];
  const selected = new Set(monitors.pages.map((page) => page.url));
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const minInterval = response.minIntervalMinutes ?? 1;
  const intervals = [...new Set([minInterval, ...INTERVALS.filter((m) => m > minInterval)])];
  const interval = Math.max(monitors.frequencyMinutes ?? 5, minInterval);
  const pagesFull = monitors.pages.length >= SETUP_LIMITS.maxPages;

  // Count what Create will add, so the cap is visible before Review.
  const planned =
    monitors.pages.length + (monitors.heartbeat ? 1 : 0) + (monitors.aiEndpoint ? 1 : 0) + (monitors.mcpMonitor ? 1 : 0);
  const remaining = response.monitorsRemaining;
  const overCap = remaining !== null && planned > remaining;

  // The server refuses a draft over 32 KB, so check the encoded size before adding a page.
  const tooBig = (pages: Page[]) => new TextEncoder().encode(JSON.stringify({ ...draft, monitors: { ...monitors, pages } })).length > MAX_DRAFT_BYTES;
  const SIZE_MESSAGE = "These pages add up to more than setup can save. Remove a page or use shorter paths.";

  const togglePage = (page: Page, on: boolean) => {
    if (on && tooBig([...monitors.pages, page])) return setPathError(SIZE_MESSAGE);
    setPathError(null);
    setMonitors({ pages: on ? [...monitors.pages, page] : monitors.pages.filter((p) => p.url !== page.url) });
  };

  const addPath = () => {
    const page = appUrl && path.trim() ? pageFor(appUrl, path) : null;
    if (!page) return setPathError("Enter a path like /pricing.");
    const rejected = pageError(page);
    if (rejected) return setPathError(`That path is too long or not valid: ${rejected}`);
    if (!selected.has(page.url) && pagesFull) return setPathError(`You can add up to ${SETUP_LIMITS.maxPages} pages.`);
    if (!selected.has(page.url) && tooBig([...monitors.pages, page])) return setPathError(SIZE_MESSAGE);
    setPathError(null);
    setPath("");
    if (!selected.has(page.url)) setMonitors({ pages: [...monitors.pages, page] });
  };

  // Heartbeat
  const hb = monitors.heartbeat;
  const [hbOpen, setHbOpen] = useState(Boolean(hb));
  const [hbName, setHbName] = useState(hb?.name ?? "Nightly job");
  const [hbEvery, setHbEvery] = useState(String(hb?.frequencyMinutes ?? 60));
  const commitHb = (name: string, every: string) => {
    const minutes = Number(every);
    const ok = !schemaError(setupNameSchema, name) && Number.isInteger(minutes) && minutes >= minInterval && minutes <= 44640;
    setMonitors({ heartbeat: ok ? { name: name.trim(), frequencyMinutes: minutes } : undefined });
  };

  // AI endpoint
  const ai = monitors.aiEndpoint;
  const [aiOpen, setAiOpen] = useState(Boolean(ai));
  const [aiForm, setAiForm] = useState({ name: ai?.name ?? "AI endpoint", url: ai?.url ?? "", model: ai?.model ?? "", secretKey: ai?.secretKey ?? "" });
  const commitAi = (next: typeof aiForm) => {
    setAiForm(next);
    const url = stripUrl(next.url, AI_ENDPOINT_QUERY_ALLOWLIST);
    const ok = !schemaError(setupNameSchema, next.name) && !schemaError(aiEndpointUrlSchema, next.url) && !schemaError(setupModelSchema, next.model) && !schemaError(secretNameSchema, next.secretKey);
    setMonitors({ aiEndpoint: ok && url ? { name: next.name.trim(), url, model: next.model.trim(), secretKey: next.secretKey } : undefined });
  };

  // MCP
  const mcp = monitors.mcpMonitor;
  const [mcpOpen, setMcpOpen] = useState(Boolean(mcp));
  const [mcpForm, setMcpForm] = useState({ name: mcp?.name ?? "MCP server", url: mcp?.url ?? "", secretKey: mcp?.secretKey ?? "" });
  const commitMcp = (next: typeof mcpForm) => {
    setMcpForm(next);
    const url = stripUrl(next.url);
    const ok = !schemaError(setupNameSchema, next.name) && !schemaError(mcpUrlSchema, next.url) && (next.secretKey === "" || !schemaError(secretNameSchema, next.secretKey));
    setMonitors({ mcpMonitor: ok && url ? { name: next.name.trim(), url, ...(next.secretKey ? { secretKey: next.secretKey } : {}) } : undefined });
  };

  return (
    <div className="space-y-6">
      {remaining !== null ? (
        <Alert variant={overCap ? "warning" : "info"} data-testid="setup-monitor-cap">
          {overCap
            ? `Your plan allows ${remaining} more monitor${remaining === 1 ? "" : "s"}. You picked ${planned}; Create continues, and monitors over the limit fail with the plan message.`
            : `Your plan allows ${remaining} more monitor${remaining === 1 ? "" : "s"}.`}
        </Alert>
      ) : null}

      <section aria-labelledby="setup-pages" className="space-y-3">
        <div>
          <h3 id="setup-pages" className="text-sm font-semibold">
            Pages to watch
          </h3>
          <p className="text-xs text-muted-foreground">
            {appUrl ? "We suggest a monitor for your homepage. Add the pages that matter." : "Add your app URL in the first step to get suggestions, or skip this step."}
          </p>
        </div>
        {suggestions.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {suggestions.map((page, index) => (
              <li key={page.url} className="flex items-center gap-3 px-4 py-2.5">
                <Checkbox
                  id={`setup-page-${index}`}
                  checked={selected.has(page.url)}
                  disabled={readOnly || (pagesFull && !selected.has(page.url))}
                  onCheckedChange={(checked) => togglePage(page, checked === true)}
                />
                <label htmlFor={`setup-page-${index}`} className="min-w-0 flex-1 truncate text-sm">
                  {page.name}
                  <span className="ml-2 text-xs text-muted-foreground">{new URL(page.url).pathname === "/" ? "Website, uptime and SSL" : "HTTP request"}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {appUrl && !readOnly ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="setup-page-path">Add a page path</Label>
              <Input
                id="setup-page-path"
                placeholder="/pricing"
                value={path}
                aria-invalid={Boolean(pathError)}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), addPath())}
              />
            </div>
            <Button type="button" variant="outline" disabled={pagesFull} onClick={addPath}>
              Add page
            </Button>
          </div>
        ) : null}
        {pathError ? <p className="text-xs text-failure">{pathError}</p> : null}
        {pagesFull ? <p className="text-xs text-muted-foreground">You have {SETUP_LIMITS.maxPages} pages, the most setup adds. Add more later from Monitors.</p> : null}

        <div className="space-y-1.5">
          <Label htmlFor="setup-interval">Check every</Label>
          <Select
            value={String(interval)}
            disabled={readOnly}
            onValueChange={(value) => setMonitors({ frequencyMinutes: Number(value) })}
          >
            <SelectTrigger id="setup-interval" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intervals.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {features.heartbeat ? (
        <OptionalCard
          id="heartbeat"
          title="Have a cron job or worker? Add a heartbeat"
          description="It pings a URL when it runs. You are alerted when a ping is missing."
          enabled={hbOpen}
          disabled={readOnly}
          onToggle={(on) => {
            setHbOpen(on);
            if (on) commitHb(hbName, hbEvery);
            else setMonitors({ heartbeat: undefined });
          }}
        >
          <Field id="setup-hb-name" label="Name" value={hbName} disabled={readOnly} maxLength={SETUP_LIMITS.maxNameChars} onChange={(e) => (setHbName(e.target.value), commitHb(e.target.value, hbEvery))} />
          <Field id="setup-hb-every" label="Expect a ping every (minutes)" type="number" min={minInterval} disabled={readOnly} error={Number(hbEvery) < minInterval || Number(hbEvery) > 44640 || !Number.isInteger(Number(hbEvery))} value={hbEvery} onChange={(e) => (setHbEvery(e.target.value), commitHb(hbName, e.target.value))} help={Number(hbEvery) < minInterval ? `Your plan allows a ping interval of ${minInterval} minutes or more.` : "The ping URL is shown once, after Create."} />
        </OptionalCard>
      ) : null}

      {features.aiEndpoint ? (
        <OptionalCard
          id="ai-endpoint"
          title="Monitor an AI endpoint"
          description="Checks an OpenAI-compatible endpoint with a small streaming request."
          enabled={aiOpen}
          disabled={readOnly}
          onToggle={(on) => {
            setAiOpen(on);
            if (on) commitAi(aiForm);
            else setMonitors({ aiEndpoint: undefined });
          }}
        >
          <Field id="setup-ai-name" label="Name" value={aiForm.name} disabled={readOnly} maxLength={SETUP_LIMITS.maxNameChars} onChange={(e) => commitAi({ ...aiForm, name: e.target.value })} />
          <Field id="setup-ai-url" label="Endpoint URL" type="url" placeholder={AI_ENDPOINT_DEFAULT_URL} value={aiForm.url} disabled={readOnly} maxLength={SETUP_LIMITS.maxUrlChars} error={Boolean(fieldError(aiEndpointUrlSchema, aiForm.url))} help={fieldError(aiEndpointUrlSchema, aiForm.url) ?? "Only api-version is kept from the query string; other parameters are dropped because they can carry keys."} onChange={(e) => commitAi({ ...aiForm, url: e.target.value })} />
          <Field id="setup-ai-model" label="Model" value={aiForm.model} disabled={readOnly} maxLength={SETUP_LIMITS.maxModelChars} error={Boolean(fieldError(setupModelSchema, aiForm.model))} help={fieldError(setupModelSchema, aiForm.model) ?? undefined} onChange={(e) => commitAi({ ...aiForm, model: e.target.value })} />
          <Field
            id="setup-ai-secret"
            label="API key secret name"
            value={aiForm.secretKey}
            disabled={readOnly}
            error={Boolean(fieldError(secretNameSchema, aiForm.secretKey))}
            help={fieldError(secretNameSchema, aiForm.secretKey) ?? "Name of a project secret, 4 to 20 characters: capitals, digits and underscores. Create it under Variables."}
            onChange={(e) => commitAi({ ...aiForm, secretKey: e.target.value.toUpperCase() })}
          />
        </OptionalCard>
      ) : null}

      {features.mcpMonitor ? (
        <OptionalCard
          id="mcp"
          title="Monitor an MCP server"
          description="Checks that the server answers and lists its tools."
          enabled={mcpOpen}
          disabled={readOnly}
          onToggle={(on) => {
            setMcpOpen(on);
            if (on) commitMcp(mcpForm);
            else setMonitors({ mcpMonitor: undefined });
          }}
        >
          <Field id="setup-mcp-name" label="Name" value={mcpForm.name} disabled={readOnly} maxLength={SETUP_LIMITS.maxNameChars} onChange={(e) => commitMcp({ ...mcpForm, name: e.target.value })} />
          <Field id="setup-mcp-url" label="Server URL" type="url" placeholder="https://mcp.example.com/mcp" value={mcpForm.url} disabled={readOnly} maxLength={SETUP_LIMITS.maxUrlChars} error={Boolean(fieldError(mcpUrlSchema, mcpForm.url))} help={fieldError(mcpUrlSchema, mcpForm.url) ?? undefined} onChange={(e) => commitMcp({ ...mcpForm, url: e.target.value })} />
          <Field
            id="setup-mcp-secret"
            label="Token secret name (optional)"
            value={mcpForm.secretKey}
            disabled={readOnly}
            error={Boolean(fieldError(secretNameSchema, mcpForm.secretKey))}
            help={fieldError(secretNameSchema, mcpForm.secretKey) ?? "Name of a project secret holding a bearer token. Leave empty for no authentication."}
            onChange={(e) => commitMcp({ ...mcpForm, secretKey: e.target.value.toUpperCase() })}
          />
        </OptionalCard>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Sparkles } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { postJson, responseError, scanMatchesUrl, suggestablePages, type StepProps } from "./step-types";

interface Suggestion {
  title: string;
  description: string;
  priority?: "low" | "medium" | "high";
}

type Failure = { kind: "locked" | "unavailable" | "error"; message: string };

const MAX_OPTIONS = 10;
const PRIORITY_TONE: Record<string, TableBadgeTone> = { high: "danger", medium: "warning", low: "neutral" };

function BetaCost() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <TableBadge tone="purple" compact>
        <Sparkles className="mr-1 size-3" aria-hidden="true" />
        Beta
      </TableBadge>
      <span data-testid="setup-tests-cost" className="text-muted-foreground">
        Suggesting requirements uses 1 AI credit, once per project per day.
      </span>
    </div>
  );
}

function UpgradeLink({ children }: { children: string }) {
  return (
    <Link href="/billing" className="font-medium underline underline-offset-4">
      {children}
    </Link>
  );
}

export function TestsStep({ response, features, permissions, draft, patchDraft, readOnly, scan }: StepProps) {
  const ticked = draft.tests?.requirements ?? [];
  // Revisiting the step keeps the ticked ones, since a second suggestion run is limited to once a day.
  const [options, setOptions] = useState<Suggestion[]>(() => {
    const saved: Suggestion[] = (draft.tests?.suggestions ?? []).map((s) => ({ ...s, description: s.description ?? "" }));
    const known = new Set(saved.map((s) => s.title));
    return [...saved, ...ticked.filter((r) => !known.has(r.title)).map((r) => ({ title: r.title, description: r.description ?? "", priority: r.priority }))];
  });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // The request outlives renders: read the selection and options as they are when it completes, not when it started.
  const latest = useRef({ ticked, options });
  useEffect(() => {
    latest.current = { ticked, options };
  });

  // Only the scan that matches the app URL on screen may feed suggestions (the server also keeps an older one).
  const matchedScan = scanMatchesUrl(scan, draft.app?.url, draft.app?.scannedUrl) ? scan : null;
  const suggestPages = matchedScan ? suggestablePages(matchedScan) : [];
  const hasScan = suggestPages.length > 0;
  const maxTicked = ticked.length >= MAX_OPTIONS;
  const locked = response.aiTestsLocked || failure?.kind === "locked";

  const setTicked = (next: Suggestion[]) =>
    patchDraft((d) => ({ ...d, tests: { ...d.tests, requirements: next.map(({ title, description, priority }) => ({ title, ...(description ? { description } : {}), ...(priority ? { priority } : {}) })) } }));
  const current: Suggestion[] = ticked.map((r) => ({ title: r.title, description: r.description ?? "", priority: r.priority }));
  const toggle = (item: Suggestion, on: boolean) => setTicked(on ? [...current, item] : current.filter((r) => r.title !== item.title));

  const suggest = async () => {
    if (!matchedScan) return;
    setLoading(true);
    setFailure(null);
    try {
      const res = await postJson<{ requirements?: Suggestion[]; code?: string; retryAt?: string }>(`/api/projects/${response.projectId}/setup/suggest-requirements`, { pages: suggestPages.map(({ path, title }) => ({ path, title })).slice(0, 50) });
      if (res.ok && res.data.requirements) {
        // One bounded set for display and for the draft: ticked ones stay, then the newest run, then older unticked ones.
        const { ticked: nowTicked, options: nowOptions } = latest.current;
        const tickedTitles = new Set(nowTicked.map((r) => r.title));
        const known = new Set(nowOptions.map((o) => o.title));
        const fresh = res.data.requirements.filter((r) => !known.has(r.title));
        const next = [...nowOptions.filter((o) => tickedTitles.has(o.title)), ...fresh, ...nowOptions.filter((o) => !tickedTitles.has(o.title))].slice(0, MAX_OPTIONS);
        setOptions(next);
        const priorities = ["low", "medium", "high"];
        const suggestions = next.map(({ title, description, priority }) => ({
          title: title.slice(0, 500),
          ...(description ? { description: description.slice(0, 2000) } : {}),
          ...(priority && priorities.includes(priority) ? { priority: priority as "low" | "medium" | "high" } : {}),
        }));
        patchDraft((d) => ({ ...d, tests: { requirements: [], ...d.tests, suggestions } }));
      } else if (res.status === 402 && res.data.code === "plan_required") {
        setFailure({ kind: "locked", message: "AI suggestions need a paid plan." });
      } else if (res.status === 402) {
        setFailure({ kind: "error", message: "Your AI credits are used up for now. Add credits or wait for the next period, then try again." });
      } else if (res.status === 429 && res.data.code === "daily_limit") {
        const when = res.data.retryAt ? new Date(res.data.retryAt).toLocaleString() : "tomorrow";
        setFailure({ kind: "error", message: `Suggestions run once per project per day. Try again after ${when}.` });
      } else if (res.status === 502 && res.data.code === "unusable_output") {
        const when = res.data.retryAt ? new Date(res.data.retryAt).toLocaleString() : "tomorrow";
        setFailure({ kind: "error", message: `AI could not produce usable suggestions. No credit was used. Suggestions are available again ${when}; you can add requirements later from Requirements.` });
      } else if (res.status === 503) {
        setFailure({ kind: "unavailable", message: "AI suggestions are not available right now." });
      } else {
        setFailure({ kind: "error", message: responseError(res.data, "Could not get suggestions. Try again.") });
      }
    } catch {
      setFailure({ kind: "error", message: "Could not get suggestions. Check your connection and try again." });
    }
    setLoading(false);
  };

  const agentCard = features.agentTest ? (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" data-testid="setup-card-agent-test">
      <div className="flex min-w-0 items-start gap-3">
        <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h3 className="text-sm font-semibold">Test an AI agent</h3>
          <p className="text-xs text-muted-foreground">Check how your agent answers. This opens the agent test form; setup keeps your place.</p>
        </div>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/playground?scriptType=agent">Create an agent test</Link>
      </Button>
    </section>
  ) : null;

  if (!permissions.canCreateTests) {
    return (
      <div className="space-y-6">
        <Alert variant="info">Ask a project admin. Only people who can create tests can suggest requirements here.</Alert>
        {agentCard}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BetaCost />
        <p className="text-sm text-muted-foreground">AI reads your scan and suggests the key user journeys as requirements. Tick the ones you want. Review creates them; then each one can generate a test.</p>
      </div>

      {locked ? (
        <Alert variant="info" data-testid="setup-tests-locked">
          <p className="text-sm font-semibold">Locked on your trial</p>
          <p className="text-sm">
            AI suggestions use AI credits, so they start on a paid plan. Everything else in setup works on the trial. <UpgradeLink>Upgrade</UpgradeLink> to unlock it, or continue without it.
          </p>
        </Alert>
      ) : failure?.kind === "unavailable" ? (
        <Alert variant="info" data-testid="setup-tests-unavailable">
          {failure.message} You can continue without it and add requirements later from Requirements.
        </Alert>
      ) : (
        <div className="space-y-3">
          {!hasScan ? <Alert variant="info">Scan your app first: scan the URL you entered in the first step to get suggestions. You can also add requirements later from Requirements.</Alert> : null}
          {failure ? <Alert variant="error">{failure.message}</Alert> : null}
          {maxTicked ? <p className="text-xs text-muted-foreground">You have ticked {MAX_OPTIONS} requirements. Untick some to ask for more suggestions.</p> : null}
          <Button type="button" variant="outline" disabled={readOnly || loading || !hasScan || maxTicked} onClick={() => void suggest()}>
            <Sparkles aria-hidden="true" />
            {loading ? "Suggesting..." : options.length > 0 ? "Suggest more" : "Suggest requirements"}
          </Button>
        </div>
      )}

      {options.length > 0 ? (
        <ul className="divide-y rounded-lg border" aria-label="Suggested requirements">
          {options.map((option, index) => (
            <li key={option.title} className="flex items-start gap-3 px-4 py-3">
              <Checkbox
                id={`setup-req-${index}`}
                className="mt-0.5"
                checked={ticked.some((r) => r.title === option.title)}
                disabled={readOnly}
                onCheckedChange={(checked) => toggle(option, checked === true)}
              />
              <label htmlFor={`setup-req-${index}`} className="min-w-0 flex-1 text-sm">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {option.title}
                  {option.priority ? (
                    <TableBadge tone={PRIORITY_TONE[option.priority] ?? "neutral"} compact>
                      {option.priority}
                    </TableBadge>
                  ) : null}
                </span>
                {option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {agentCard}
    </div>
  );
}

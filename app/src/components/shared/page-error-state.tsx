import Link from "next/link";
import { RefreshCw, SearchX, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type LoadErrorKind = "not_found" | "forbidden" | "failed";

/** Sorts a server action's error text so the page can say what happened instead of echoing it. */
export function classifyLoadError(message: string | null | undefined): LoadErrorKind {
  const text = (message ?? "").toLowerCase();
  if (text.includes("insufficient permission")) return "forbidden";
  // Actions answer "not found or access denied" for both, so the page words it that way too.
  if (text.includes("not found") || text.includes("access denied") || text.startsWith("invalid ")) return "not_found";
  return "failed";
}

const VISUAL: Record<LoadErrorKind, { icon: LucideIcon; tone: string }> = {
  not_found: { icon: SearchX, tone: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  forbidden: { icon: ShieldAlert, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  failed: { icon: TriangleAlert, tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
};

/**
 * Full-page state for a record that could not be loaded: what happened, what to do next, and the
 * server's own message as small print. `noun` is the lower-case record name ("incident", "service").
 */
export function PageErrorState({
  noun,
  message,
  backHref,
  backLabel,
  onRetry,
  retrying,
}: {
  noun: string;
  message: string | null | undefined;
  backHref: string;
  backLabel: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const kind = classifyLoadError(message);
  const { icon: Icon, tone } = VISUAL[kind];
  const copy = {
    not_found: {
      title: `This ${noun} could not be found`,
      body: `It may have been deleted, or it belongs to another project. Check the link, or pick a ${noun} from the list.`,
    },
    forbidden: {
      title: `You do not have access to this ${noun}`,
      body: "Your role cannot view it. Ask a project admin for access if you need it.",
    },
    failed: {
      title: `Could not load this ${noun}`,
      body: "Something went wrong on our side. Try again in a moment; if it keeps happening, contact support.",
    },
  }[kind];

  return (
    <div role="alert" data-testid="page-error-state" className="flex min-h-72 flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span aria-hidden="true" className={`inline-flex size-14 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="size-7" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{copy.body}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry && kind === "failed" && (
            <Button type="button" onClick={onRetry} disabled={retrying}>
              <RefreshCw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
              Try again
            </Button>
          )}
          <Button asChild variant={onRetry && kind === "failed" ? "outline" : "default"}>
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        </div>
        {message && (
          <p className="rounded-md bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{message}</p>
        )}
      </div>
    </div>
  );
}

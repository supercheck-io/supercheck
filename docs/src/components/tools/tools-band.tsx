import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { primaryButton, textLink } from "../landing/buttons";
import { tools } from "../../lib/tools";
import { ToolChip } from "./tool-chip";

/** Landing-page entry to the free tools. A plain GET form: it pre-fills the uptime checker, which never runs a check by itself. */
export function ToolsBand() {
  return (
    <section aria-labelledby="free-tools-heading" className="border-t border-fd-border">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,28rem)] lg:items-end">
          <div>
            <h2 id="free-tools-heading" className="text-xl font-semibold tracking-tight">
              Try a free check, no account
            </h2>
            <p className="mt-2 text-sm text-fd-muted-foreground">Eight quick checks for any public site, from uptime to security headers.</p>
          </div>
          <form action="/tools/website-uptime-checker" method="get" className="flex gap-2">
            <label htmlFor="free-tools-url" className="sr-only">
              Website to check
            </label>
            <input
              id="free-tools-url"
              name="url"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              placeholder="your-site.com"
              className="min-w-0 flex-1 rounded-md border border-fd-border bg-fd-background px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-fd-primary"
            />
            <button type="submit" className={`${primaryButton} shrink-0 whitespace-nowrap`}>
              Check site
            </button>
          </form>
        </div>
        <ul className="mt-8 flex flex-wrap gap-2">
          {tools.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`/tools/${tool.slug}`}
                className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card py-1.5 pr-3 pl-1.5 text-sm font-medium transition-colors hover:border-fd-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
              >
                <ToolChip tool={tool.id} size="sm" />
                {tool.name}
              </Link>
            </li>
          ))}
          <li className="flex items-center pl-1">
            <Link href="/tools" className={textLink}>
              All free tools
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

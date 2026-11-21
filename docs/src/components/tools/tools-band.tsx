import Link from "next/link";
import { ArrowRight, Globe } from "lucide-react";
import { textLink } from "../landing/buttons";
import { tools } from "../../lib/tools";

/**
 * Hero entry to the free tools, beside the CTAs and matched to their height.
 * A plain GET form: it pre-fills the uptime checker, which never runs a check by itself.
 */
export function ToolsBand() {
  return (
    <section
      aria-labelledby="free-check-heading"
      className="flex flex-col border-t border-fd-border pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12"
    >
      <div>
        <h2 id="free-check-heading" className="text-sm leading-5 font-medium">
          Check your site for free
        </h2>
        <p className="text-sm leading-5 text-fd-muted-foreground">Uptime, HTTPS, security headers, DNS and more. No sign-up.</p>
      </div>
      <form
        action="/tools/website-uptime-checker"
        method="get"
        className="mt-5 flex items-center gap-1 rounded-md border border-fd-border bg-fd-card p-[3px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fd-primary"
      >
        <Globe className="ml-2 size-4 shrink-0 text-fd-muted-foreground" aria-hidden="true" />
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
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-fd-muted-foreground"
        />
        <button
          type="submit"
          className="shrink-0 whitespace-nowrap rounded border border-fd-border bg-fd-background px-3 py-1.5 text-sm leading-5 font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
        >
          Check site
        </button>
      </form>
      <Link href="/tools" className={`${textLink} mt-2 self-start`}>
        See all {tools.length} free tools
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}

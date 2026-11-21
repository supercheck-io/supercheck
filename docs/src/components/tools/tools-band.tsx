import Link from "next/link";
import { ArrowRight, Globe } from "lucide-react";
import { textLink } from "../landing/buttons";

/** Hero entry to the free tools. A plain GET form: it pre-fills the uptime checker, which never runs a check by itself. */
export function ToolsBand() {
  return (
    <div className="mt-6 max-w-xl">
      <form
        action="/tools/website-uptime-checker"
        method="get"
        className="flex items-center gap-1 rounded-lg border border-fd-border bg-fd-card p-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fd-primary"
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
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-fd-muted-foreground"
        />
        <button
          type="submit"
          className="shrink-0 whitespace-nowrap rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
        >
          Check site
        </button>
      </form>
      <p className="mt-2 text-sm text-fd-muted-foreground">
        Free site check, no account needed.{" "}
        <Link href="/tools" className={textLink}>
          See all 8 free tools
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </p>
    </div>
  );
}

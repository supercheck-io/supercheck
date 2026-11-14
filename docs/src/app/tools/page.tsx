import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Braces, CalendarClock, Globe, Lock, Network, Share2, ShieldHalf, type LucideIcon } from "lucide-react";
import { OG_IMAGE } from "../../lib/assets";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";
import { IconChip } from "../../components/landing/ui";
import { tools } from "../../lib/tools";
import type { ToolId } from "../../lib/tools-funnel";

const title = "Free website and API checking tools | Supercheck";
const description = "Eight quick checks for any public site: uptime, API, HTTPS, security headers, AI agent readiness, DNS, social preview and domain expiry. No account needed.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/tools" },
  openGraph: { title, description, url: "/tools", siteName: "Supercheck", type: "website", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
};

const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  uptime: Globe,
  api: Braces,
  https: Lock,
  headers: ShieldHalf,
  agents: Bot,
  dns: Network,
  social: Share2,
  domain: CalendarClock,
};

export default function ToolsHub() {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-16 sm:px-6 md:pt-24">
          <p className="text-sm font-medium text-monitor">Free tools</p>
          <h1 className="mt-3 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Check a site in seconds</h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-fd-muted-foreground">
            Eight quick checks for any public site. No account needed. Each runs once from Cloudflare&apos;s edge and says plainly what one check can&apos;t tell you.
          </p>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tools.map((tool) => (
              <li key={tool.slug}>
                <Link
                  href={`/tools/${tool.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                >
                  <IconChip icon={TOOL_ICONS[tool.id]} area={tool.id === "agents" ? "ai" : "monitor"} />
                  <span className="mt-4 font-semibold">{tool.name}</span>
                  <span className="mt-1.5 flex-1 text-sm leading-relaxed text-fd-muted-foreground">{tool.summary}</span>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fd-primary">
                    Open
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-fd-muted-foreground">
            The checks are made by SupercheckBot.{" "}
            <Link href="/tools/bot" className="text-fd-primary hover:underline">
              What it does and how to opt out
            </Link>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

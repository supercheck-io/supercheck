import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronDown, Info } from "lucide-react";
import { OG_IMAGE } from "../../../lib/assets";
import { SiteHeader } from "../../../components/site-header";
import { SiteFooter } from "../../../components/site-footer";
import { Checker } from "../../../components/tools/checker";
import { GradeMethod } from "../../../components/tools/grade-method";
import { TOOL_LOOK, ToolChip } from "../../../components/tools/tool-chip";
import { getTool, tools } from "../../../lib/tools";

export const dynamicParams = false;

export function generateStaticParams() {
  return tools.map((tool) => ({ tool: tool.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ tool: string }> }): Promise<Metadata> {
  const tool = getTool((await params).tool);
  if (!tool) return {};
  // Canonical without the query, so ?url= share links are not duplicates.
  const url = `/tools/${tool.slug}`;
  const title = `${tool.name}: free, no sign-up | Supercheck`;
  return {
    title: { absolute: title },
    description: tool.metaDescription,
    alternates: { canonical: url },
    openGraph: { title, description: tool.metaDescription, url, siteName: "Supercheck", type: "website", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description: tool.metaDescription, images: [OG_IMAGE] },
  };
}

export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const tool = getTool((await params).tool);
  if (!tool) notFound();

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 md:pt-20">
          <div className="flex items-center gap-2.5 text-sm font-medium">
            <ToolChip tool={tool.id} size="sm" />
            <Link href="/tools" className="text-fd-muted-foreground hover:text-fd-foreground hover:underline">
              Free tools
            </Link>
          </div>
          <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{tool.title}</h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-fd-muted-foreground">{tool.intro}</p>
          <div className="mt-8 max-w-3xl">
            <Checker
              tool={tool.id}
              slug={tool.slug}
              input={tool.input}
              placeholder={tool.placeholder}
              submitLabel={tool.submitLabel}
              ctaTitle={tool.ctaTitle}
              ctaBody={tool.ctaBody}
            />
          </div>
        </section>

        <section aria-labelledby="how-heading" className="border-t border-fd-border">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-2">
            <div className="rounded-xl border border-fd-border bg-fd-card p-6">
              <h2 id="how-heading" className="text-lg font-semibold tracking-tight">
                How we check
              </h2>
              <ul className="mt-4 space-y-3 text-sm">
                {tool.howWeCheck.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check className={`mt-0.5 size-4 shrink-0 ${TOOL_LOOK[tool.id].text}`} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-fd-border bg-fd-card p-6">
              <h2 className="text-lg font-semibold tracking-tight">What this check can&apos;t tell you</h2>
              <ul className="mt-4 space-y-3 text-sm text-fd-muted-foreground" data-testid="tool-limits">
                {tool.limits.map((limit) => (
                  <li key={limit} className="flex gap-2.5">
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>{limit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {tool.id === "headers" && <GradeMethod />}
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-fd-border">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[1fr_2fr]">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight">
              Questions
            </h2>
            {/* Native details: answers stay in the static HTML for search engines, and it works without JS. */}
            <div className="divide-y divide-fd-border overflow-hidden rounded-xl border border-fd-border bg-fd-card">
              {tool.faq.map((item) => (
                <details key={item.question} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fd-primary [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <ChevronDown className="size-4 shrink-0 text-fd-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-relaxed text-fd-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <nav aria-labelledby="more-tools-heading" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="more-tools-heading" className="text-2xl font-semibold tracking-tight">
              More free tools
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tools
                .filter((other) => other.slug !== tool.slug)
                .map((other) => (
                  <li key={other.slug}>
                    <Link
                      href={`/tools/${other.slug}`}
                      className="flex items-center gap-3 rounded-lg border border-fd-border bg-fd-card p-3 text-sm font-medium transition-colors hover:border-fd-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                    >
                      <ToolChip tool={other.id} size="sm" />
                      {other.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        </nav>
      </main>
      <SiteFooter />
    </div>
  );
}

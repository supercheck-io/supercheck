import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { OG_IMAGE } from "../../../lib/assets";
import { SiteHeader } from "../../../components/site-header";
import { SiteFooter } from "../../../components/site-footer";
import { CheckList, textLink } from "../../../components/landing/ui";
import { Checker } from "../../../components/tools/checker";
import { GradeMethod } from "../../../components/tools/grade-method";
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
          <p className={`text-sm font-medium ${tool.id === "agents" ? "text-ai" : "text-monitor"}`}>
            <Link href="/tools" className="hover:underline">
              Free tool
            </Link>
          </p>
          <h1 className="mt-3 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{tool.title}</h1>
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

        <section aria-labelledby="how-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-2">
            <div>
              <h2 id="how-heading" className="text-2xl font-semibold tracking-tight">
                How we check
              </h2>
              <CheckList items={tool.howWeCheck} area={tool.id === "agents" ? "ai" : "monitor"} className="mt-6" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">What this check can&apos;t tell you</h2>
              <ul className="mt-6 space-y-2.5 text-sm text-fd-muted-foreground" data-testid="tool-limits">
                {tool.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
          </div>
          {tool.id === "headers" && <GradeMethod />}
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight">
              Questions
            </h2>
            <dl className="mt-8 grid gap-x-8 gap-y-8 md:grid-cols-2">
              {tool.faq.map((item) => (
                <div key={item.question} className="border-t border-fd-border pt-6">
                  <dt className="font-semibold">{item.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <nav aria-labelledby="more-tools-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="more-tools-heading" className="text-2xl font-semibold tracking-tight">
              More free tools
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tools
                .filter((other) => other.slug !== tool.slug)
                .map((other) => (
                  <li key={other.slug}>
                    <Link href={`/tools/${other.slug}`} className={textLink}>
                      {other.name}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
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

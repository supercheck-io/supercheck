import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import { SiteHeader } from "../../../components/site-header";
import { SiteFooter } from "../../../components/site-footer";
import { primaryButton, secondaryButton } from "../../../components/landing/ui";
import { comparisons, getComparison, getCompetitor } from "../../../lib/comparisons";
import { CAPABILITY_ROWS, COMPETITOR_AS_OF } from "../../../lib/pricing-data";
import { DEMO_URL } from "../../../lib/site-nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return comparisons.map((comparison) => ({ vendor: comparison.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ vendor: string }> }): Promise<Metadata> {
  const comparison = getComparison((await params).vendor);
  if (!comparison) return {};
  const url = `/compare/${comparison.slug}`;
  const title = `Supercheck vs ${comparison.vendorName} | Supercheck`;
  const description = `Compare Supercheck and ${comparison.vendorName} using each vendor's public pricing page, as of ${COMPETITOR_AS_OF}.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "Supercheck", type: "website", images: ["/screenshots/playground-editor.png"] },
    twitter: { card: "summary_large_image", title, description, images: ["/screenshots/playground-editor.png"] },
  };
}

export default async function ComparePage({ params }: { params: Promise<{ vendor: string }> }) {
  const comparison = getComparison((await params).vendor);
  const competitor = comparison && getCompetitor(comparison.vendorKey);
  if (!comparison || !competitor) notFound();
  const { vendorKey, vendorName } = comparison;

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-16 sm:px-6 md:pt-24 md:pb-20">
          <p className="text-sm font-medium text-fd-primary">Moving from another tool?</p>
          <h1 className="mt-3 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:leading-[1.08]">
            Supercheck vs {vendorName}
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-fd-muted-foreground">
            What each product includes, taken from the vendors&apos; public pricing pages as of {COMPETITOR_AS_OF}. Check{" "}
            <a href={competitor.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fd-foreground">
              the {vendorName} pricing page
            </a>{" "}
            for current terms.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/pricing" className={primaryButton}>
              Estimate your monthly cost
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
              Try the live demo
            </a>
          </div>
        </section>

        <section aria-labelledby="table-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="table-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Capabilities side by side
            </h2>
            <div className="mt-8 overflow-x-auto rounded-lg border bg-fd-background" role="region" aria-label={`Supercheck and ${vendorName} capabilities`} tabIndex={0}>
              <table className="w-full min-w-[40rem] table-fixed">
                <caption className="sr-only">
                  Capabilities of Supercheck and {vendorName}, as of {COMPETITOR_AS_OF}
                </caption>
                <thead className="bg-fd-muted">
                  <tr>
                    <th scope="col" className="w-1/3 px-3 py-3 text-left text-sm font-medium">
                      <span className="sr-only">Capability</span>
                    </th>
                    <th scope="col" className="bg-fd-primary/10 px-3 py-3 text-left text-sm font-medium text-fd-primary">
                      Supercheck
                    </th>
                    <th scope="col" className="px-3 py-3 text-left text-sm font-medium">
                      {vendorName}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITY_ROWS.map((row, index) => (
                    <tr key={row.name} className={index % 2 === 0 ? "bg-fd-muted/30" : "bg-fd-card"}>
                      <th scope="row" className="px-3 py-3 text-left text-sm font-normal">
                        {row.name}
                      </th>
                      <td className="bg-fd-primary/5 px-3 py-3 text-sm font-medium">{row.supercheck}</td>
                      <td className="px-3 py-3 text-sm text-fd-muted-foreground">{row[vendorKey]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 max-w-3xl text-xs leading-relaxed text-fd-muted-foreground">
              &quot;Not listed&quot; means the vendor&apos;s pricing page names no such product. It does not mean the capability cannot be assembled
              from other tools. A range in the Supercheck column runs from its lowest to its highest plan.
            </p>
          </div>
        </section>

        <section aria-labelledby="billing-heading" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="billing-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              How {vendorName} bills
            </h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-fd-muted-foreground">{competitor.billing}</p>
            <p className="mt-3 max-w-3xl leading-relaxed text-fd-muted-foreground">{competitor.note}</p>
            <p className="mt-6 flex flex-wrap items-center gap-x-2 text-sm text-fd-muted-foreground">
              <span>Source, as of {competitor.asOf}:</span>
              <a
                href={competitor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-fd-primary hover:underline"
              >
                {vendorName} pricing
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </p>
          </div>
        </section>

        <section className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:py-20">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Run your own numbers</h2>
              <p className="mt-3 text-fd-muted-foreground">
                The pricing page estimates a monthly cost for your browser checks across Supercheck, Checkly, Datadog, Better Stack and BrowserStack.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/pricing" className={primaryButton}>
                Open the estimator
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link href="/docs/app/deployment/self-hosted" className={secondaryButton}>
                Self-host Supercheck
              </Link>
            </div>
          </div>
        </section>

        <nav aria-labelledby="other-comparisons-heading" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="other-comparisons-heading" className="text-2xl font-semibold tracking-tight">
              Other comparisons
            </h2>
            <ul className="mt-6 flex flex-wrap gap-3">
              {comparisons
                .filter((other) => other.slug !== comparison.slug)
                .map((other) => (
                  <li key={other.slug}>
                    <Link href={`/compare/${other.slug}`} className={secondaryButton}>
                      Supercheck vs {other.vendorName}
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

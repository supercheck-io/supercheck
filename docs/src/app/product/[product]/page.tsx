import type { Metadata } from "next";
import { OG_IMAGE } from "../../../lib/assets";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "../../../components/site-header";
import { SiteFooter } from "../../../components/site-footer";
import { StepVisual, CheckList, primaryButton, secondaryButton, textLink } from "../../../components/landing/ui";
import { getProduct, products } from "../../../lib/products";
import { DEMO_URL } from "../../../lib/site-nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return products.map((product) => ({ product: product.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ product: string }> }): Promise<Metadata> {
  const product = getProduct((await params).product);
  if (!product) return {};
  const url = `/product/${product.slug}`;
  const title = `${product.metaTitle} | Supercheck`;
  return {
    title: { absolute: title },
    description: product.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: product.metaDescription,
      url,
      siteName: "Supercheck",
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: product.metaDescription,
      images: [OG_IMAGE],
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ product: string }> }) {
  const product = getProduct((await params).product);
  if (!product) notFound();

  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-16 sm:px-6 md:pt-24 md:pb-20">
          <p className="text-sm font-medium text-fd-primary">{product.eyebrow}</p>
          <h1 className="mt-3 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:leading-[1.08]">
            {product.title}
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-fd-muted-foreground">{product.intro}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
              Try the live demo
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
            <Link href={product.guide.href} className={secondaryButton}>
              {product.guide.label}
            </Link>
          </div>
        </section>

        <section aria-labelledby="capabilities-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="capabilities-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Key capabilities
            </h2>
            <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
              {product.capabilities.map((capability) => (
                <div key={capability.title} className="border-t border-fd-border pt-6">
                  <h3 className="font-semibold">{capability.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{capability.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="How it works" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl space-y-20 px-4 py-20 sm:px-6 md:space-y-28 md:py-24">
            {product.steps.map((step, index) => (
              <div
                key={step.title}
                className={`grid items-center gap-8 lg:gap-14 ${index % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}`}
              >
                <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                  <h2 className="text-balance text-2xl font-semibold tracking-tight">{step.title}</h2>
                  <p className="mt-3 text-pretty leading-relaxed text-fd-muted-foreground">{step.body}</p>
                  {step.visual && <CheckList items={step.bullets} className="mt-6" />}
                  <Link href={step.href} className={`${textLink} mt-6`}>
                    {step.linkLabel}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
                <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
                  <StepVisual step={step} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="faq-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Frequently asked questions
            </h2>
            <dl className="mt-10 grid gap-x-8 gap-y-8 md:grid-cols-2">
              {product.faq.map((item) => (
                <div key={item.question} className="border-t border-fd-border pt-6">
                  <dt className="font-semibold">{item.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-fd-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:py-20">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.closing.title}</h2>
              <p className="mt-3 text-fd-muted-foreground">{product.closing.body}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
                Open the live demo
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <Link href="/docs/app/deployment/self-hosted" className={secondaryButton}>
                Self-host Supercheck
              </Link>
            </div>
          </div>
        </section>

        <nav aria-labelledby="other-products-heading" className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 id="other-products-heading" className="text-2xl font-semibold tracking-tight">
              More from Supercheck
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-3">
              {products
                .filter((other) => other.slug !== product.slug)
                .map((other) => (
                  <li key={other.slug}>
                    <Link
                      href={`/product/${other.slug}`}
                      className="group flex h-full flex-col rounded-xl border border-fd-border bg-fd-background p-6 transition-colors hover:border-fd-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                    >
                      <span className="font-semibold">{other.name}</span>
                      <span className="mt-1.5 flex-1 text-sm leading-relaxed text-fd-muted-foreground">{other.metaDescription}</span>
                      <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-fd-primary">
                        Learn more
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                      </span>
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

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BellRing, CircleCheck, Code, Globe, Radio, Siren, Sparkles } from "lucide-react";
import { SiteHeader } from "../../components/site-header";
import { CodeWindow } from "../../components/landing/code-window";
import { CopyCommand, HeroVideo } from "../../components/landing/interactive";
import { CheckList, IconChip, Screenshot, SectionHeading, SolutionCards, primaryButton, secondaryButton, textLink, type Area } from "../../components/landing/ui";
import { SiteFooter } from "../../components/site-footer";
import { toolGroups } from "../../components/landing/tool-logos";
import { ToolsBand } from "../../components/tools/tools-band";
import { DEMO_URL, GITHUB_URL } from "../../lib/site-nav";
import { OG_IMAGE, versioned } from "../../lib/assets";

const TITLE = "Supercheck: open-source testing, monitoring and AI SRE";
const DESCRIPTION =
  "Open-source platform for Playwright and k6 testing, uptime and synthetic monitoring, AI incident investigation and status pages. Self-host free or use Supercheck Cloud.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: "Supercheck", type: "website", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

// Organization and software facts for search results. Free to self-host, so the offer price is 0.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://supercheck.io/#organization",
      name: "Supercheck",
      url: "https://supercheck.io",
      logo: "https://supercheck.io/supercheck-logo.png",
      sameAs: [GITHUB_URL],
    },
    {
      "@type": "WebSite",
      "@id": "https://supercheck.io/#website",
      name: "Supercheck",
      url: "https://supercheck.io",
      publisher: { "@id": "https://supercheck.io/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      name: "Supercheck",
      url: "https://supercheck.io",
      description: DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Linux",
      license: "https://www.gnu.org/licenses/agpl-3.0.html",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": "https://supercheck.io/#organization" },
    },
  ],
};

// Order follows the path of a failure: tested, caught, handled, announced.
const products = [
  {
    title: "Automate",
    area: "automate" as Area,
    icon: Code,
    summary: "Write, record and run end-to-end and load tests.",
    href: "/docs/app/automate",
    shot: { src: "/screenshots/site/playground-editor.webp", alt: "Playground editor with a Playwright checkout test" },
    items: [
      "Playwright browser, API and database tests",
      "k6 load tests with live logs and run comparison",
      "Jobs on a schedule or from CI",
      "Recorder extension for Chrome and Edge",
      "Requirements with coverage tracking",
    ],
  },
  {
    title: "Monitor",
    area: "monitor" as Area,
    icon: Globe,
    summary: "Know when something breaks before your users tell you.",
    href: "/docs/app/monitor",
    shot: { src: "/screenshots/site/monitors-list.webp", alt: "Monitors list with HTTP, website, ping, port and synthetic monitors" },
    items: [
      "HTTP, website, ping and port checks",
      "Checks from Europe, North America and Asia Pacific on Cloud",
      "Synthetic monitors that replay Playwright journeys",
      "Thresholds that cut noisy alerts",
    ],
  },
  {
    title: "Respond",
    area: "respond" as Area,
    icon: Siren,
    summary: "Failing checks with alerts on open an incident you can work from.",
    href: "/docs/app/investigate",
    shot: { src: "/screenshots/site/incident-workspace-overview.webp", alt: "Incident workspace for a Checkout API outage with an AI summary" },
    items: [
      "One incident per failing source, resolved on recovery unless acknowledged",
      "AI SRE investigations that cite evidence",
      "Copilot chat and a service catalog",
      "Read-only connectors: GitHub, Kubernetes, Prometheus, Grafana, Sentry, Datadog",
      "Private Agent for internal systems",
    ],
  },
  {
    title: "Communicate",
    area: "communicate" as Area,
    icon: Radio,
    summary: "Tell your team first, then tell your users.",
    href: "/docs/app/communicate",
    shot: { src: "/screenshots/site/status-page-public.webp", alt: "Public status page with a partial outage banner and 90 days of uptime per component" },
    items: [
      "Notifications by email, Slack, Teams, Discord, Telegram and webhooks",
      "Public status pages on your own domain",
      "Email, Slack, webhook, RSS and calendar subscribers",
    ],
  },
];

const flow: { step: string; body: string; area: Area; icon: typeof Globe }[] = [
  { step: "Check", body: "A monitor or job with alerts on fails past its threshold.", area: "monitor", icon: Globe },
  { step: "Alert", body: "Your channels are notified.", area: "communicate", icon: BellRing },
  { step: "Incident", body: "An incident opens with its alerts.", area: "respond", icon: Siren },
  { step: "Investigate", body: "AI SRE investigates and cites evidence. You decide the fix.", area: "ai", icon: Sparkles },
  { step: "Recover", body: "The check passes and an unacknowledged incident resolves.", area: "monitor", icon: CircleCheck },
];

const configExample = `import { defineConfig } from '@supercheck/cli'

export default defineConfig({
  schemaVersion: '1.0',
  project: { organization: '<org-id>', project: '<project-id>' },
  tests: {
    playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts' },
    k6: { testMatch: '_supercheck_/k6/**/*.k6.ts' },
  },
  monitors: [
    {
      name: 'API health',
      type: 'http_request',
      target: 'https://api.example.com/health',
      frequencyMinutes: 5,
    },
  ],
  jobs: [
    {
      name: 'Nightly E2E suite',
      tests: ['_supercheck_/playwright/checkout.pw.ts'],
      jobType: 'playwright',
      cronSchedule: '0 2 * * *',
    },
  ],
})`;

const runOptions = [
  {
    title: "Isolated by default",
    body: "Tests run in Kubernetes workloads sandboxed with gVisor. Private networks, mail ports and cluster control ports are blocked.",
    link: { href: "/docs/app/deployment/self-hosted#architecture", label: "How execution is isolated" },
  },
  {
    title: "Self-host for free",
    body: "Open source under AGPLv3. Run it with Docker Compose and K3s, with no license fee or usage limits.",
    link: { href: "/docs/app/deployment/self-hosted", label: "Self-hosting guide" },
  },
  {
    title: "Or let us run it",
    body: "Managed hosting with monitoring in Europe, North America and Asia Pacific. Coming soon; join the waitlist.",
    link: { href: "/pricing", label: "See Cloud plans" },
  },
];

export default async function HomePage() {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 md:pt-24">
          <a
            href="https://github.com/supercheck-io/supercheck"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
          >
            Open source under AGPLv3 · View on GitHub
          </a>
          <h1 className="mt-4 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl md:leading-[1.05]">
            Open-source testing, monitoring, and AI SRE{" "}
            <span className="whitespace-nowrap">
              – <span className="hero-accent">as code</span>
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
            Playwright and k6 tests, uptime monitors, AI incident response and status pages in one
            platform. Self-host today, or join the Cloud waitlist.
          </p>
          <div className="mt-8 grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-0">
            <div className="flex flex-col items-start lg:pr-12">
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
                  Try the live demo
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
                <Link href="/docs/app/welcome" className={secondaryButton}>
                  Read the docs
                </Link>
              </div>
              <div className="mt-5">
                <CopyCommand />
              </div>
              <p className="mt-2 text-sm text-fd-muted-foreground">
                then <code className="font-mono text-[13px] text-fd-foreground">supercheck init</code>
              </p>
            </div>
            <ToolsBand />
          </div>

          <div className="mt-14 md:mt-16">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.25)]">
              <HeroVideo>
                <Image
                  src={versioned("/supercheck-screenshot.webp")}
                  alt=""
                  fill
                  sizes="(min-width: 1152px) 1152px, 100vw"
                  className="object-cover object-top"
                  priority
                />
              </HeroVideo>
            </div>
          </div>
        </section>

        {/* Works with */}
        <section aria-labelledby="works-with-heading" className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <h2 id="works-with-heading" className="text-sm text-fd-muted-foreground">
              Works with the tools you already use
            </h2>
            <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_auto]">
              {toolGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="text-xs font-medium text-fd-muted-foreground">{group.title}</h3>
                  <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                    {group.tools.map((tool) => (
                      <li key={tool.name} className="flex items-center gap-2 text-sm font-medium text-fd-foreground/80">
                        {tool.mark}
                        {tool.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* Product */}
        <section className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <SectionHeading eyebrow="Platform" title="One place for the work between deploy and incident">
              Tests, uptime, incidents and status pages, sharing one set of projects, alerts and history.
            </SectionHeading>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border lg:grid-cols-5">
              {flow.map((item, index) => (
                <li key={item.step} className="bg-fd-background p-5">
                  <div className="flex items-center justify-between">
                    <IconChip icon={item.icon} area={item.area} />
                    <p className="font-mono text-xs text-fd-muted-foreground">{String(index + 1).padStart(2, "0")}</p>
                  </div>
                  <h3 className="mt-4 font-semibold">{item.step}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fd-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-16 space-y-20 md:space-y-28">
              {products.map((product, index) => (
                <div
                  key={product.title}
                  className={`grid items-center gap-8 lg:gap-14 ${index % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}`}
                >
                  <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                    <IconChip icon={product.icon} area={product.area} />
                    <h3 className="mt-4 text-2xl font-semibold tracking-tight">{product.title}</h3>
                    <p className="mt-2 text-fd-muted-foreground">{product.summary}</p>
                    <CheckList items={product.items} area={product.area} className="mt-6" />
                    <Link href={product.href} className={`${textLink} mt-6`}>
                      {product.title} docs
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                  <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
                    <Screenshot src={product.shot.src} alt={product.shot.alt} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Solutions */}
        <section className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <SectionHeading eyebrow="Solutions" title="Built for the people who keep software working">
              How developers, SRE, QA and engineering leaders use Supercheck.
            </SectionHeading>
            <SolutionCards className="mt-12" />
          </div>
        </section>

        {/* As code */}
        <section className="border-t border-fd-border">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <SectionHeading eyebrow="As code" title="Keep tests and monitors in your repository">
                Define tests, monitors and jobs in one TypeScript file. Review in pull requests, deploy from
                your terminal or CI.
              </SectionHeading>
              <div className="mt-8 overflow-hidden rounded-lg border border-fd-border">
                <table className="w-full text-sm">
                  <thead className="bg-fd-muted/40 text-left text-xs text-fd-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Command</th>
                      <th scope="col" className="px-4 py-2 font-medium">What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["supercheck pull", "Export what already exists in a project"],
                      ["supercheck diff", "Preview what a deploy would change"],
                      ["supercheck deploy", "Apply the configuration"],
                    ].map(([cmd, desc]) => (
                      <tr key={cmd} className="border-t border-fd-border">
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px]">{cmd}</td>
                        <td className="px-4 py-2.5 text-fd-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-8 rounded-lg border border-fd-border p-4">
                <p className="text-sm font-medium">Ask your AI tools about it</p>
                <p className="mt-1 text-sm text-fd-muted-foreground">
                  An MCP server, read-only by default, lets Claude, Cursor and VS Code read tests, runs, monitors and
                  incidents. Off by default when self-hosting.
                </p>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
                <Link href="/docs/cli" className={textLink}>
                  CLI documentation
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
                <Link href="/docs/mcp" className={textLink}>
                  MCP server
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <CodeWindow code={configExample} filename="supercheck.config.ts" />
          </div>
        </section>

        {/* Where it runs */}
        <section className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <SectionHeading eyebrow="Deployment" title="Run it on your servers or ours" />
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border md:grid-cols-3">
              {runOptions.map((option) => (
                <div key={option.title} className="flex flex-col bg-fd-background p-6 sm:p-8">
                  <h3 className="font-semibold">{option.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-fd-muted-foreground">{option.body}</p>
                  <Link href={option.link.href} className={`${textLink} mt-6`}>
                    {option.link.label}
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="border-t border-fd-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:py-20">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Click through a real workspace</h2>
              <p className="mt-3 text-fd-muted-foreground">
                Sample data, no sign-up.
              </p>
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
      </main>

      <SiteFooter />
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { SiteHeader } from "../../components/site-header";
import { CodeWindow } from "../../components/landing/code-window";
import { CopyCommand, DemoVideo } from "../../components/landing/interactive";
import { SiteFooter } from "../../components/site-footer";

const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "https://demo.supercheck.dev";

const pillars = [
  {
    title: "Test",
    summary: "Write, record and run end-to-end and load tests.",
    href: "/docs/app/automate",
    items: [
      "Playwright browser, API and database tests",
      "k6 load tests with streaming logs and run comparison",
      "Recorder extension for Chrome and Edge",
      "AI test generation and failure fixes",
      "Requirements with coverage tracking",
    ],
  },
  {
    title: "Monitor",
    summary: "Know when something breaks, and tell your users.",
    href: "/docs/app/monitor",
    items: [
      "HTTP, website, ping and port checks",
      "Checks from locations in Europe, North America and Asia Pacific",
      "Synthetic monitors that replay Playwright journeys",
      "Alerts by email, Slack, Teams, Discord, Telegram and webhooks",
      "Public status pages with email and webhook subscribers",
    ],
  },
  {
    title: "Investigate",
    summary: "Find the cause of an incident with evidence, not guesses.",
    href: "/docs/app/investigate",
    items: [
      "Incidents linked to the alerts and runs that raised them",
      "AI SRE investigations that cite their evidence",
      "Read-only connectors for GitHub, Kubernetes, Prometheus, Grafana, Sentry and Datadog",
      "Private Agent for systems inside your network",
      "Service catalog and investigation map",
    ],
  },
];

const configExample = `import { defineConfig } from '@supercheck/cli'

export default defineConfig({
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
      jobType: 'playwright',
      cronSchedule: '0 2 * * *',
    },
  ],
})`;

const runOptions = [
  {
    title: "Isolated by default",
    body: "Tests run in isolated Kubernetes workloads sandboxed with gVisor. Private and cluster networks are blocked, so a test script cannot reach your infrastructure.",
    link: { href: "/docs/app/automate", label: "How execution works" },
  },
  {
    title: "Self-host for free",
    body: "The core is open source under AGPLv3. Run it on your own servers with Docker Compose and K3s, with no license fee and no usage limits.",
    link: { href: "/docs/app/deployment/self-hosted", label: "Self-hosting guide" },
  },
  {
    title: "Or let us run it",
    body: "Supercheck Cloud is a managed service with monitoring locations in Europe, North America and Asia Pacific. It is coming soon; the waitlist is open.",
    link: { href: "/pricing", label: "See Cloud plans" },
  },
];

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium text-fd-primary">{eyebrow}</p>
      <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {children && <p className="mt-3 text-fd-muted-foreground">{children}</p>}
    </div>
  );
}

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";
const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md border border-fd-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";

export default async function HomePage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-fd-background text-fd-foreground">
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
            Open-Source Testing, Monitoring, and AI SRE{" "}
            <span className="whitespace-nowrap">
              — <span className="hero-accent">as Code</span>
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
            Run Playwright and k6 tests, monitor your sites and APIs from multiple regions,
            keep users informed with status pages, and investigate incidents with an AI SRE
            that shows its evidence. Self-host it, or use Supercheck Cloud when it opens.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
              Try the live demo
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
            <Link href="/docs/app/welcome" className={secondaryButton}>
              Read the docs
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fd-muted-foreground">
            <CopyCommand />
            <span>
              then <code className="font-mono text-[13px] text-fd-foreground">supercheck init</code>
            </span>
          </div>

          <div className="mt-14 md:mt-16">
            <DemoVideo />
          </div>
        </section>

        {/* What it does */}
        <section className="border-t border-fd-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <SectionHeading eyebrow="Platform" title="One place for the work between deploy and incident">
              Most teams stitch together a test runner, an uptime service, a status page and a pile of
              dashboards. Supercheck covers all four, sharing one set of projects, alerts and history.
            </SectionHeading>
            <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {pillars.map((pillar) => (
                <div key={pillar.title} className="flex flex-col border-t border-fd-border pt-6">
                  <h3 className="text-lg font-semibold">{pillar.title}</h3>
                  <p className="mt-1 text-sm text-fd-muted-foreground">{pillar.summary}</p>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                    {pillar.items.map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-fd-muted-foreground" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={pillar.href}
                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
                  >
                    {pillar.title} docs
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* As code */}
        <section className="border-t border-fd-border bg-fd-card/40">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <SectionHeading eyebrow="As code" title="Keep tests and monitors in your repository">
                Define Playwright and k6 tests, monitors and scheduled jobs in one TypeScript file.
                Review changes in pull requests, then apply them from your terminal or CI pipeline.
              </SectionHeading>
              <dl className="mt-8 space-y-4 text-sm">
                {[
                  ["supercheck pull", "Export what already exists in a project."],
                  ["supercheck diff", "See exactly what a deploy would change."],
                  ["supercheck deploy", "Apply the configuration to Supercheck."],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                    <dt className="w-40 shrink-0 font-mono text-[13px]">{cmd}</dt>
                    <dd className="text-fd-muted-foreground">{desc}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8 rounded-lg border border-fd-border p-4">
                <p className="text-sm font-medium">Ask your AI tools about it</p>
                <p className="mt-1 text-sm text-fd-muted-foreground">
                  A read-only MCP server lets Claude, Cursor, VS Code and other MCP clients look at
                  a project&apos;s tests, runs, monitors and incidents. Off by default when self-hosting.
                </p>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
                <Link
                  href="/docs/cli"
                  className="inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
                >
                  CLI documentation
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/docs/mcp"
                  className="inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
                >
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
                  <Link
                    href={option.link.href}
                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
                  >
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
                Explore a sample workspace in the live demo. No sign-up needed.
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

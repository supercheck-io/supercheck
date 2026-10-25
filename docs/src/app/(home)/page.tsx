import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "../../components/site-header";
import { CodeWindow } from "../../components/landing/code-window";
import { CopyCommand, DemoVideo } from "../../components/landing/interactive";
import { CheckList, Screenshot, SectionHeading, SolutionCards, primaryButton, secondaryButton, textLink } from "../../components/landing/ui";
import { SiteFooter } from "../../components/site-footer";
import { toolGroups } from "../../components/landing/tool-logos";
import { DEMO_URL } from "../../lib/site-nav";

const products = [
  {
    title: "Automate",
    summary: "Write, record and run end-to-end and load tests.",
    href: "/docs/app/automate",
    shot: { src: "/screenshots/site/playground-editor.webp", alt: "Playground editor with a Playwright API test" },
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
    summary: "Know when something breaks before your users tell you.",
    href: "/docs/app/monitor",
    shot: { src: "/screenshots/site/monitors-list.webp", alt: "Monitors list with HTTP, website, ping, port and synthetic monitors" },
    items: [
      "HTTP, website, ping and port checks",
      "Checks from several regions, including Europe, North America and Asia Pacific on Cloud",
      "Synthetic monitors that replay Playwright journeys",
      "Failure and recovery thresholds to cut noisy alerts",
    ],
  },
  {
    title: "Communicate",
    summary: "Tell your team first, then tell your users.",
    href: "/docs/app/communicate",
    shot: { src: "/screenshots/site/status-page-public.webp", alt: "Public status page showing all systems operational" },
    items: [
      "Alerts by email, Slack, Teams, Discord, Telegram and webhooks",
      "Public status pages on your own domain",
      "Email, Slack and webhook subscribers, plus RSS and calendar feeds",
      "Project dashboard for runs, jobs and uptime",
    ],
  },
  {
    title: "Investigate",
    summary: "Find the cause of an incident with evidence, not guesses.",
    href: "/docs/app/investigate",
    shot: { src: "/screenshots/site/incident-workspace-overview.webp", alt: "Incident workspace for an API gateway incident" },
    items: [
      "Incidents linked to the alerts and runs that raised them",
      "AI SRE investigations that cite their evidence",
      "Read-only connectors for GitHub, Kubernetes, Prometheus, Grafana, Sentry and Datadog",
      "Private Agent for systems inside your network",
    ],
  },
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

export default async function HomePage() {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
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
            Open-source testing, monitoring, and AI SRE, as code
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fd-muted-foreground">
            Test with Playwright and k6. Monitor your sites and APIs, keep users informed
            with status pages, and investigate incidents with AI that shows its evidence.
            Self-host today, or join the Supercheck Cloud waitlist.
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
              Most teams stitch together a test runner, an uptime service, a status page and a pile of
              dashboards. Supercheck covers all four, sharing one set of projects, alerts and history.
            </SectionHeading>
            <div className="mt-16 space-y-20 md:space-y-28">
              {products.map((product, index) => (
                <div
                  key={product.title}
                  className={`grid items-center gap-8 lg:gap-14 ${index % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}`}
                >
                  <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                    <h3 className="text-2xl font-semibold tracking-tight">{product.title}</h3>
                    <p className="mt-2 text-fd-muted-foreground">{product.summary}</p>
                    <CheckList items={product.items} className="mt-6" />
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
              See how developers, on-call engineers, test automation teams and engineering leaders use Supercheck.
            </SectionHeading>
            <SolutionCards className="mt-12" />
          </div>
        </section>

        {/* As code */}
        <section className="border-t border-fd-border">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <SectionHeading eyebrow="As code" title="Keep tests and monitors in your repository">
                Define Playwright and k6 tests, monitors and scheduled jobs in one TypeScript file.
                Review changes in pull requests, then apply them from your terminal or CI pipeline.
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
                  A read-only MCP server lets Claude, Cursor, VS Code and other MCP clients look at
                  a project&apos;s tests, runs, monitors and incidents. Off by default when self-hosting.
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

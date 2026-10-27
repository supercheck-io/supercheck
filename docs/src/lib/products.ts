// Product pages under /product. Every claim here must match a docs page linked
// from the same block. Cloud is waitlist-only and its browser, Playwright and k6
// execution runs in Europe, so nothing here promises multi-region browser checks.
import type { SolutionStep, SolutionVisual } from "./solutions";

export interface Product {
  slug: string;
  name: string;
  eyebrow: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  guide: { href: string; label: string };
  capabilities: { title: string; body: string }[];
  steps: SolutionStep[];
  faq: { question: string; answer: string }[];
  closing: { title: string; body: string };
}

const shot = (name: string, alt: string): SolutionVisual => ({
  kind: "image",
  src: `/screenshots/site/${name}.webp`,
  alt,
});

export const products: Product[] = [
  {
    slug: "uptime-monitoring",
    name: "Uptime monitoring",
    eyebrow: "Uptime monitoring",
    metaTitle: "Uptime monitoring",
    metaDescription:
      "Check HTTP endpoints, websites, SSL certificates, hosts and ports on a schedule, and send alerts to Slack, Teams, email and more.",
    title: "Know when a site, API or port stops responding",
    intro:
      "Run HTTP, website, ping and port monitors on a schedule with check intervals down to one minute. Alerts go to the channels your team already uses, and each monitor keeps its response time and uptime history.",
    guide: { href: "/docs/app/monitor", label: "Read the monitor guide" },
    capabilities: [
      {
        title: "Four lightweight check types",
        body: "HTTP monitors check status codes, headers, authentication and response keywords. Website monitors add SSL certificate tracking. Ping monitors test TCP reachability on ports 443 and 80, and port monitors test TCP or UDP ports.",
      },
      {
        title: "Thresholds that limit noise",
        body: "Set how many consecutive failures trigger an alert and how many healthy checks confirm recovery. Failure and recovery thresholds each accept 1 to 5.",
      },
      {
        title: "History you can read at a glance",
        body: "Each monitor shows uptime, average response time and P95 response time over 24 hours and 30 days, plus the last 100 checks and a paginated results table.",
      },
    ],
    steps: [
      {
        title: "Pick a check type and an interval",
        body: "Choose the monitor type that matches what you run, point it at an endpoint or host, and set how often it checks.",
        bullets: [
          "HTTP: methods, custom headers, Basic or Bearer auth, expected status and keyword validation",
          "Website: expected status and SSL certificate expiry",
          "Ping: TCP reachability on port 443 or 80, not ICMP",
          "Port: TCP or UDP. A UDP check sends a packet and does not confirm the application replied",
        ],
        href: "/docs/app/monitor#monitor-types",
        linkLabel: "Monitor types",
      },
      {
        title: "Send alerts where your team already works",
        body: "Configure a notification channel, send a test message, then attach it to a monitor with the thresholds you want.",
        bullets: [
          "Email, Slack, Discord, Telegram, Microsoft Teams and webhook channels",
          "Optional alert on recovery",
          "SSL expiration warnings on website monitors, at most once every 24 hours",
        ],
        href: "/docs/app/communicate/alerts",
        linkLabel: "Alerts guide",
        visual: shot("notification-channels", "Notification channels list in Supercheck"),
      },
      {
        title: "See every monitor in one list",
        body: "The monitor list shows current status for every check. Open a monitor for its metrics, charts and recent results, or pause it during maintenance.",
        bullets: [
          "Status: Up, Down, Paused, Pending, Maintenance or Error",
          "Run AI Analyze on a monitor for a health summary and suggested causes",
          "Publish the result on a status page for your users",
        ],
        href: "/docs/app/monitor#monitor-details-page",
        linkLabel: "Monitor details",
        visual: shot("monitors-list", "Monitors list with status for each check"),
      },
    ],
    faq: [
      {
        question: "How often can a monitor check?",
        answer:
          "Check intervals go down to one minute. Synthetic monitors, which run Playwright tests, have a five-minute minimum.",
      },
      {
        question: "Does the ping monitor use ICMP?",
        answer:
          "No. Ping monitors open a TCP connection on port 443 or 80. If the host accepts neither, the check fails.",
      },
      {
        question: "Which alert channels are supported?",
        answer: "Email, Slack, Discord, Telegram, Microsoft Teams and webhooks.",
      },
      {
        question: "Can I run it on my own servers?",
        answer:
          "Yes. Supercheck core is open source under AGPLv3 and can be self-hosted. Supercheck Cloud is waitlist-only.",
      },
      {
        question: "Does AI Analyze need extra setup?",
        answer: "On a self-hosted install, an administrator must configure an AI provider first.",
      },
    ],
    closing: {
      title: "Add your first monitor",
      body: "Explore the live demo to see monitors, results and alerts with sample data.",
    },
  },
  {
    slug: "synthetic-monitoring",
    name: "Synthetic monitoring",
    eyebrow: "Synthetic monitoring",
    metaTitle: "Synthetic monitoring with Playwright",
    metaDescription:
      "Run Playwright browser tests against production on a schedule, with reports, traces and alerts when a user journey fails.",
    title: "Run your Playwright tests against production on a schedule",
    intro:
      "Write or record a Playwright test, attach it to a synthetic monitor and let Supercheck run it on an interval. When a journey such as login or checkout breaks, you get an alert and a report with the failing step.",
    guide: { href: "/docs/app/monitor#synthetic-monitor", label: "Read the synthetic monitor guide" },
    capabilities: [
      {
        title: "The same tests you run in CI",
        body: "A synthetic monitor runs a saved Playwright test, so one script can be used in a job, from the CLI and as a production check.",
      },
      {
        title: "Reports for failed checks",
        body: "A failed synthetic check links to a report with the error, expected and received values, a step timeline and a trace viewer with video, screenshots and network logs.",
      },
      {
        title: "Author in the browser or record a flow",
        body: "Write tests in the Playground, or record a flow with the Supercheck Recorder extension for Chrome and Edge and save it as a Playwright test.",
      },
    ],
    steps: [
      {
        title: "Create the test",
        body: "Open the Playground, write or record a Playwright test, run it and save it to your project.",
        bullets: [
          "Run the test in the Playground before you save it",
          "Recorder extension for Chrome and Edge",
          "AI Create and AI Fix suggest changes that you review before applying",
        ],
        href: "/docs/app/automate/playground",
        linkLabel: "Playground guide",
        visual: shot("playground-editor", "Playwright test open in the Supercheck Playground"),
      },
      {
        title: "Attach it to a synthetic monitor",
        body: "Create a synthetic monitor, select the saved test and choose an interval. The minimum is five minutes. Set the interval longer than the test takes so runs do not overlap.",
        bullets: [
          "Choose notification channels and failure and recovery thresholds",
          "Pause the monitor during planned maintenance",
        ],
        href: "/docs/app/monitor#synthetic-monitor",
        linkLabel: "Synthetic monitors",
        visual: shot("create-synthetic-monitor", "Create synthetic monitor form"),
      },
      {
        title: "Open the report when it fails",
        body: "From the monitor's recent results, open the report for a failed check to see which step failed and why.",
        bullets: [
          "Test summary with browser and duration",
          "Assertion errors with a stack trace",
          "Trace viewer with video, screenshots and network logs",
          "Copy Prompt copies the error details for AI-assisted debugging",
        ],
        href: "/docs/app/monitor#monitor-reports",
        linkLabel: "Monitor reports",
      },
    ],
    faq: [
      {
        question: "How often can a synthetic monitor run?",
        answer:
          "The minimum interval is five minutes. Set it longer than your test takes, for example five minutes or more for a two-minute test.",
      },
      {
        question: "Can I check from several regions?",
        answer:
          "Not on Supercheck Cloud at launch: it is waitlist-only and runs browser, Playwright and k6 execution in Europe. On a self-hosted install, checks run from wherever you run workers.",
      },
      {
        question: "Does it work with tests I already have?",
        answer:
          "Monitors run Playwright tests saved in your Supercheck project. The CLI can pull a project into a config file and test scripts in your repository, and deploy changes back.",
      },
      {
        question: "What happens when a check fails?",
        answer:
          "The result is recorded, alerts follow your thresholds, and a report is generated with the error, steps and trace.",
      },
    ],
    closing: {
      title: "Watch a user journey run on a schedule",
      body: "Explore the live demo to see synthetic monitors and reports with sample data.",
    },
  },
  {
    slug: "ai-sre",
    name: "AI SRE",
    eyebrow: "AI SRE",
    metaTitle: "AI SRE for incident investigation",
    metaDescription:
      "Open an incident, run a read-only AI investigation over your monitor, test and connector evidence, and review cited findings and evidence gaps.",
    title: "Investigations that cite their evidence",
    intro:
      "When a monitor fails, open an incident and run a read-only AI investigation over stored results, test artifacts and the connectors you enable. Findings link to evidence, and missing data is reported as a gap.",
    guide: { href: "/docs/app/investigate", label: "Read the investigate guide" },
    capabilities: [
      {
        title: "Read-only by design",
        body: "Supercheck recommends checks and fixes. It does not change your infrastructure. A full investigation starts when you select Run investigation; administrators can separately enable automatic triage.",
      },
      {
        title: "Cited findings",
        body: "Reports label statements as Fact, Inference or Hypothesis. If the evidence cannot determine a cause, the report states the gap.",
      },
      {
        title: "Evidence from where you already look",
        body: "It reads stored monitor results, synthetic test artifacts, run logs and status page states, and optional read-only connectors such as Prometheus, Grafana, Loki, Kubernetes, Sentry and GitHub.",
      },
    ],
    steps: [
      {
        title: "Open an incident from an alert",
        body: "Select Investigate next to a failure signal, or create an incident from scratch. Opening an incident does not start an investigation.",
        bullets: [
          "Filter the queue by severity SEV1 to SEV4",
          "Link the incident to a service in the catalog",
          "Trends show volume and mean time to resolution for the last 30 days",
        ],
        href: "/docs/app/investigate/incidents",
        linkLabel: "Incident guide",
        visual: shot("incident-workspace-overview", "Incident workspace overview in Supercheck"),
      },
      {
        title: "Run the investigation and review the report",
        body: "The investigation reads stored evidence and, if you turn on live sources, queries your connectors.",
        bullets: [
          "What changed, blast radius, strongest signals and likely cause",
          "Evidence gaps and next safe checks",
          "Save the report or download an evidence brief as Markdown",
        ],
        href: "/docs/app/investigate/incidents#ai-summary",
        linkLabel: "Investigation report",
      },
      {
        title: "Ask follow-up questions in Copilot",
        body: "Copilot answers operational questions in general chat or inside an incident, using saved evidence and, when Live sources is on, fresh connector data.",
        bullets: [
          "Incident chat keeps the incident's evidence in context",
          "Chat history is private to you within the organization and project",
          "Copilot cannot change your systems or apply a fix",
        ],
        href: "/docs/app/investigate/copilot",
        linkLabel: "Copilot guide",
      },
      {
        title: "Connect read-only sources",
        body: "Add connectors under Organization, Integrations. Use a Private Agent for APIs that are reachable only inside your network.",
        bullets: [
          "Prometheus, Grafana, AWS CloudWatch, Datadog, Loki and Elasticsearch / OpenSearch",
          "Grafana Tempo, Kubernetes, Sentry, GitHub, GitLab, PagerDuty and Opsgenie",
          "Credentials and raw connector responses are excluded from saved reports",
        ],
        href: "/docs/app/investigate/connectors",
        linkLabel: "Connectors",
      },
    ],
    faq: [
      {
        question: "Does AI SRE change my systems?",
        answer:
          "No. It is read-only. You apply fixes with your own tools, then re-run tests and review monitors to confirm recovery.",
      },
      {
        question: "Do I need connectors?",
        answer:
          "No. Connectors are optional. You can start with the evidence Supercheck already stores from its own monitors, tests and runs.",
      },
      {
        question: "Does it watch videos or read screenshots?",
        answer:
          "No. The agent reads bounded text evidence and artifact references. Open screenshots and videos yourself from the run or monitor.",
      },
      {
        question: "Which AI provider does it use?",
        answer:
          "Self-hosted installs use an AI provider that an administrator configures. Supercheck Cloud is waitlist-only.",
      },
      {
        question: "Who can run investigations?",
        answer:
          "Org Owners, Org Admins and Project Admins can run investigations and use live sources. Project Editors can investigate stored evidence. Project Viewers can view incidents.",
      },
    ],
    closing: {
      title: "See an investigation end to end",
      body: "Explore the live demo to see incidents and evidence with sample data.",
    },
  },
  {
    slug: "status-pages",
    name: "Status pages",
    eyebrow: "Status pages",
    metaTitle: "Status pages",
    metaDescription:
      "Publish a status page with components linked to monitors, incident updates, scheduled maintenance and subscriber notifications.",
    title: "Keep users informed while you fix the problem",
    intro:
      "Publish a page that shows component status from your monitors, posts incident and maintenance updates, and notifies subscribers by email, Slack, webhook, RSS and iCal.",
    guide: { href: "/docs/app/communicate/status-pages", label: "Read the status pages guide" },
    capabilities: [
      {
        title: "Status from your monitors",
        body: "Link monitors to a component and pick an aggregation method: worst, best, majority vote or weighted average. The page shows check-based 90-day uptime for each public component.",
      },
      {
        title: "Incidents and maintenance",
        body: "Post incidents with a timeline of updates, or schedule maintenance with a start and end. Monitor alerts are suppressed during a maintenance window, while checks still run.",
      },
      {
        title: "Your domain and your branding",
        body: "Use a generated subdomain or a verified custom subdomain, add a logo, favicon and status colors, and show the page in one of 24 languages.",
      },
    ],
    steps: [
      {
        title: "Create the page and add components",
        body: "Create a draft, add at least one public component and link the monitors that decide its status.",
        bullets: [
          "Component status is manual until you link a monitor",
          "Optional automatic outage and recovery incidents, off by default",
          "Internal services can be linked without publishing their details",
        ],
        href: "/docs/app/communicate/status-pages#components",
        linkLabel: "Components",
      },
      {
        title: "Publish and share",
        body: "Publish the page and share its URL. Visitors see the status banner, component uptime and incident history without signing in.",
        bullets: [
          "Custom domain through a CNAME and TXT record",
          "SVG status badge you can embed",
          "Unpublish returns the page to draft and keeps components, incidents and subscribers",
        ],
        href: "/docs/app/communicate/status-pages#create-and-publish",
        linkLabel: "Create and publish",
        visual: shot("status-page-public", "Public Supercheck status page"),
      },
      {
        title: "Post updates and notify subscribers",
        body: "Create an incident, choose the affected components and post updates as the status moves from Investigating to Resolved.",
        bullets: [
          "Subscribers by email, Slack and webhook, plus RSS and iCal feeds",
          "Webhook deliveries are signed with HMAC-SHA256",
          "Link a private incident without publishing its investigation notes",
        ],
        href: "/docs/app/communicate/status-pages#subscribers",
        linkLabel: "Subscribers",
      },
    ],
    faq: [
      {
        question: "Can visitors subscribe to updates?",
        answer:
          "Yes. Visitors can subscribe by email, Slack or webhook, and can follow the whole page or specific components. RSS and iCal feeds are available when enabled.",
      },
      {
        question: "Can I use my own domain?",
        answer:
          "Yes, as a subdomain such as status.example.net. Apex domains are not supported. Self-hosted installs supply their own certificate.",
      },
      {
        question: "Is uptime a time-weighted SLA?",
        answer:
          "No. Uptime is successful checks divided by total checks over the last 90 UTC days. Days without checks show no data.",
      },
      {
        question: "Are my internal investigation notes published?",
        answer:
          "No. A linked internal incident stays private. Only the public title and message you write are published.",
      },
    ],
    closing: {
      title: "Publish a status page",
      body: "Explore the live demo to see a status page with sample incidents.",
    },
  },
];

export const getProduct = (slug: string) => products.find((product) => product.slug === slug);

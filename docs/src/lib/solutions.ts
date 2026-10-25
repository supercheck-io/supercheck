// Persona pages under /solutions. Every claim here must match a docs page linked
// from the same block; Cloud is waitlist-only and its browser, Playwright and k6
// execution runs in Europe, so nothing here promises multi-region browser checks.

export type SolutionVisual =
  | { kind: "image"; src: string; alt: string }
  | { kind: "code"; code: string; filename: string; lang: string };

export interface SolutionStep {
  title: string;
  body: string;
  bullets: string[];
  href: string;
  linkLabel: string;
  visual?: SolutionVisual;
}

export interface Solution {
  slug: string;
  role: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  guide: { href: string; label: string };
  problems: { title: string; body: string }[];
  steps: SolutionStep[];
  closing: { title: string; body: string };
}

const shot = (name: string, alt: string): SolutionVisual => ({
  kind: "image",
  src: `/screenshots/site/${name}.webp`,
  alt,
});

export const solutions: Solution[] = [
  {
    slug: "developers",
    role: "For developers",
    metaTitle: "Supercheck for developers",
    metaDescription:
      "Keep Playwright tests, k6 scripts, monitors and schedules in your repository as TypeScript, review them in pull requests and deploy them from CI.",
    title: "Tests and monitors that live next to your code",
    intro:
      "Define Playwright tests, k6 scripts, monitors and schedules in TypeScript. Review them in pull requests, then deploy them from your terminal or CI with the Supercheck CLI.",
    guide: { href: "/docs/cli", label: "Read the CLI guide" },
    problems: [
      {
        title: "Monitors edited by hand drift",
        body: "A change made in a web form leaves no review trail. With supercheck.config.ts, monitor and job changes go through a pull request, and supercheck diff shows what a deploy will change.",
      },
      {
        title: "Green in CI, broken in production",
        body: "Run the same Playwright tests from CI, then schedule them as jobs or attach them to synthetic monitors that keep checking production.",
      },
      {
        title: "Flaky selectors eat your afternoon",
        body: "AI Fix reads a failed run and proposes a change to the script. You review it side by side with the original and decide whether to apply it.",
      },
    ],
    steps: [
      {
        title: "Start from the project you already have",
        body: "Pull exports an existing project into a config file and test scripts. From then on, diff and deploy keep Supercheck in step with your repository.",
        bullets: [
          "Monitors, jobs, alert channels, variables, tags and status pages in one file",
          "Test scripts written under _supercheck_/",
          "Changed files are backed up before pull overwrites them",
        ],
        href: "/docs/cli/commands#monitoring-as-code",
        linkLabel: "Monitoring-as-code commands",
        visual: {
          kind: "code",
          filename: "terminal",
          lang: "bash",
          code: `# Export what already exists in the project
supercheck pull

# See exactly what a deploy would change
supercheck diff

# Apply the configuration
supercheck deploy

# Write a GitHub Actions workflow for pull requests and main
supercheck ci init --github`,
        },
      },
      {
        title: "Fix a failing test without starting over",
        body: "Write tests in the Playground with templates and autocomplete. When one fails, AI Fix suggests a change that you can accept or reject.",
        bullets: [
          "Browser, API, database and custom Playwright tests",
          "AI Create drafts a test from a description",
          "Variables and secrets available inside every script",
        ],
        href: "/docs/app/automate/playground",
        linkLabel: "Playground and AI Fix",
        visual: shot("ai-fix-result-dialog", "AI Fix review dialog showing the original script beside the suggested fix"),
      },
      {
        title: "Give your coding agent the context",
        body: "Install the Supercheck skill for your coding agent, and connect AI tools to the read-only MCP server so they can look at tests, runs, monitors and incidents.",
        bullets: [
          "supercheck agent install for Claude, Cursor, Codex and OpenCode",
          "MCP clients sign in with your Supercheck account",
          "The MCP server is read-only and off by default when self-hosting",
        ],
        href: "/docs/mcp/connect",
        linkLabel: "Connect an MCP client",
        visual: {
          kind: "code",
          filename: "terminal",
          lang: "bash",
          code: `# Install the Supercheck skill for your coding agent
supercheck agent install --target claude

# Connect Claude Code to the read-only MCP server
claude mcp add --transport http supercheck \\
  https://your-supercheck-host/api/mcp`,
        },
      },
    ],
    closing: {
      title: "Put your first monitor in a pull request",
      body: "Explore a sample workspace in the live demo, or install the CLI and run supercheck init in your repository.",
    },
  },
  {
    slug: "sre",
    role: "For SRE and platform teams",
    metaTitle: "Supercheck for SRE and platform teams",
    metaDescription:
      "Uptime and synthetic monitoring, alert routing, status pages and read-only AI incident investigation, open source and self-hostable.",
    title: "Uptime, alerts and incident evidence in one place",
    intro:
      "Check sites, APIs and hosts from several regions. Send alerts where your team already works, keep users informed on a status page, and investigate incidents with the evidence in front of you.",
    guide: { href: "/docs/app/monitor", label: "Read the monitoring guide" },
    problems: [
      {
        title: "Alerts that nobody trusts",
        body: "One failed probe should not page anyone. Set how many consecutive failures raise an alert, and how results from several regions combine before a monitor goes down.",
      },
      {
        title: "Users hear about outages first",
        body: "Link monitors to status page components and post incident updates that reach subscribers by email, Slack, webhook or feed.",
      },
      {
        title: "Evidence scattered across tools",
        body: "AI SRE reads metrics, logs, traces, deploys and errors through read-only connectors, and cites what it found so you can check it.",
      },
    ],
    steps: [
      {
        title: "Monitor from several regions",
        body: "Run HTTP, website, ping and port monitors with check intervals down to one minute. Supercheck Cloud will check from Europe, North America and Asia Pacific; self-hosted installs check from wherever you run workers.",
        bullets: [
          "Website monitors track SSL certificate expiry",
          "Failure and recovery thresholds from 1 to 5 consecutive checks",
          "Regional results combined with a strategy and threshold",
        ],
        href: "/docs/app/monitor",
        linkLabel: "Monitor types",
        visual: shot("create-monitor-multilocation-selector", "Monitor location settings with three regions selected"),
      },
      {
        title: "Route alerts to the right channel",
        body: "Send failure and recovery alerts for monitors and jobs to the tools your team already watches.",
        bullets: [
          "Email, Slack, Microsoft Teams, Discord, Telegram and webhooks",
          "Alert history for every monitor and job",
          "Test a channel before you rely on it",
        ],
        href: "/docs/app/communicate/alerts",
        linkLabel: "Alerts and channels",
        visual: shot("notification-channels", "Notification channels list with Discord, webhook, Slack and email channels"),
      },
      {
        title: "Investigate with cited evidence",
        body: "Open an incident from an alert, then run a read-only investigation. Findings link back to the evidence, and you decide what to change.",
        bullets: [
          "Prometheus, Grafana, Loki, Tempo, AWS CloudWatch, Elasticsearch and OpenSearch",
          "Kubernetes, Sentry, Datadog, GitHub, GitLab, PagerDuty and Opsgenie",
          "Private Agent reaches systems inside your network without inbound access",
        ],
        href: "/docs/app/investigate/incidents",
        linkLabel: "Incident investigation",
        visual: shot("incident-workspace-overview", "Incident workspace for an API gateway incident with severity and status"),
      },
      {
        title: "Keep users informed",
        body: "Publish a status page on your own domain with components, incident history and subscriptions.",
        bullets: [
          "Components linked to monitors",
          "Email, Slack and webhook subscribers, plus RSS and calendar feeds",
          "Custom domains",
        ],
        href: "/docs/app/communicate/status-pages",
        linkLabel: "Status pages",
        visual: shot("status-page-public", "Public status page showing all systems operational with uptime bars"),
      },
    ],
    closing: {
      title: "Run it next to the systems it watches",
      body: "Self-host Supercheck on your own Linux servers with Docker Compose, or explore the live demo first.",
    },
  },
  {
    slug: "qa",
    role: "For QA engineers",
    metaTitle: "Supercheck for QA engineers",
    metaDescription:
      "Record, write and schedule Playwright browser, API and database tests and k6 load tests, then keep production covered with synthetic monitors.",
    title: "Record, run and schedule your Playwright and k6 suites",
    intro:
      "Build browser, API and database tests in the Playground or record them in your browser. Run them on demand, on a schedule or from CI, and keep production covered with synthetic monitors.",
    guide: { href: "/docs/app/automate", label: "Read the testing guide" },
    problems: [
      {
        title: "Every test written from scratch",
        body: "Record a flow with the Supercheck Recorder for Chrome or Edge, or describe it to AI Create, then edit the Playwright script it produces.",
      },
      {
        title: "Suites that only run before a release",
        body: "Group tests into jobs that run on a cron schedule or from CI, and attach a test to a synthetic monitor to keep checking production.",
      },
      {
        title: "Coverage nobody can see",
        body: "Track requirements, link them to the tests that cover them, and filter by coverage status to find the gaps.",
      },
    ],
    steps: [
      {
        title: "Write, record or generate a test",
        body: "The Playground is a browser-based editor for Playwright and k6 scripts, with templates, AI Create and AI Fix.",
        bullets: [
          "Recorder extension for Chrome and Edge",
          "Browser, API, database and custom tests",
          "Reports with traces, screenshots and video for every run",
        ],
        href: "/docs/app/automate/playground",
        linkLabel: "Playground",
        visual: shot("playground-editor", "Playground editor with a Playwright API test and test details panel"),
      },
      {
        title: "Load test with k6",
        body: "Run k6 scripts, follow the logs as they stream, and compare two runs side by side to spot a regression.",
        bullets: [
          "Virtual users, load profiles and thresholds",
          "Streaming logs while the test runs",
          "Side-by-side comparison of two runs of a job",
        ],
        href: "/docs/app/automate/performance-test",
        linkLabel: "Performance tests",
        visual: shot("dashboard-k6-report-comparison", "Comparison of two k6 run reports side by side"),
      },
      {
        title: "Turn a test into a monitor",
        body: "Select an existing Playwright test and run it on a schedule as a synthetic monitor, with the same alerts as any other monitor.",
        bullets: [
          "Synthetic checks every 5 minutes or longer",
          "Alerts on failure and recovery",
          "The monitor reuses the test you already maintain",
        ],
        href: "/docs/app/monitor#synthetic-monitor",
        linkLabel: "Synthetic monitors",
        visual: shot("create-synthetic-monitor", "Synthetic monitor form with an existing test selected"),
      },
      {
        title: "Know what is covered",
        body: "Add requirements by hand or extract them from a PRD or specification with AI, then link each one to its tests.",
        bullets: [
          "Extract requirements from PDF, DOCX, Markdown or text",
          "Filter by priority, coverage status and tags",
          "Export requirements as CSV",
        ],
        href: "/docs/app/automate/requirements",
        linkLabel: "Requirements",
      },
    ],
    closing: {
      title: "Give your suite a schedule",
      body: "Open the live demo to try the Playground, or install the Recorder and record your first flow.",
    },
  },
  {
    slug: "engineering-managers",
    role: "For engineering managers",
    metaTitle: "Supercheck for engineering managers",
    metaDescription:
      "Requirement coverage, a project dashboard, role-based access and an audit log for your teams' tests, monitors and incidents.",
    title: "See what is tested, monitored and who owns it",
    intro:
      "Supercheck keeps tests, monitors, incidents and status pages in one organization, with a project for each team, role-based access and an audit log.",
    guide: { href: "/docs/app/admin", label: "Read the admin guide" },
    problems: [
      {
        title: "Coverage is an estimate",
        body: "Link requirements to tests and see which ones have tests and whether those tests pass, instead of asking each team.",
      },
      {
        title: "Reliability work spread across tools",
        body: "Tests, monitors, alerts, status pages and incident investigations share one set of projects, so there is one place to review.",
      },
      {
        title: "No record of who changed what",
        body: "Organization and project roles control who can edit, and the audit log records administrative actions across the organization.",
      },
    ],
    steps: [
      {
        title: "One dashboard per project",
        body: "See test runs, job results, monitor status and uptime trends for a project at a glance.",
        bullets: [
          "Playwright and k6 analytics",
          "Monitor status and uptime trend",
          "Recent runs and their results",
        ],
        href: "/docs/app/communicate/dashboard",
        linkLabel: "Dashboard",
        visual: shot("dashboard", "Project dashboard with test, job and monitor metrics and charts"),
      },
      {
        title: "Coverage you can export",
        body: "Turn a PRD into a requirements list with AI, link each requirement to tests, and share the result.",
        bullets: [
          "AI-extracted requirements are tagged for review",
          "Coverage status per requirement",
          "CSV export for reviews and audits",
        ],
        href: "/docs/app/automate/requirements",
        linkLabel: "Requirements",
      },
      {
        title: "Access that matches your org chart",
        body: "Give each team a project, invite members by email, and assign roles at the organization or project level.",
        bullets: [
          "Org Owner, Org Admin, Project Admin, Project Editor and Project Viewer",
          "Audit log of administrative actions",
          "Project-scoped CLI tokens for each pipeline",
        ],
        href: "/docs/app/admin/roles-and-permissions",
        linkLabel: "Roles and permissions",
      },
      {
        title: "Keep your data where you choose",
        body: "Supercheck core is open source under AGPLv3. Self-host it with no license fee and use your own AI provider, or join the waitlist for Supercheck Cloud.",
        bullets: [
          "Docker Compose on one Linux server, or several servers",
          "Tests run in a gVisor sandbox",
          "No usage limits when self-hosted",
        ],
        href: "/docs/app/deployment/self-hosted",
        linkLabel: "Self-hosting guide",
      },
    ],
    closing: {
      title: "Review coverage, not status reports",
      body: "Explore the live demo to see projects, requirements and the dashboard with sample data.",
    },
  },
];

export const getSolution = (slug: string) => solutions.find((solution) => solution.slug === slug);

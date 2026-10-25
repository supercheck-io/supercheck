import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Bell,
  BookOpen,
  Bot,
  Braces,
  Cable,
  ClipboardCheck,
  Code,
  Gauge,
  Globe,
  History,
  Layers,
  ListChecks,
  MousePointerClick,
  PanelsTopLeft,
  Server,
  Siren,
  Sparkles,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";

export const GITHUB_URL = "https://github.com/supercheck-io/supercheck";
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || "https://demo.supercheck.dev";

export interface NavItem {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface NavMenu {
  label: string;
  groups: NavGroup[];
}

// Product groups mirror the docs sidebar (Automate, Monitor, Communicate, Investigate).
export const productMenu: NavMenu = {
  label: "Product",
  groups: [
    {
      title: "Automate",
      items: [
        { title: "Browser tests", description: "Playwright end-to-end tests in a real browser", href: "/docs/app/automate/browser-test", icon: AppWindow },
        { title: "API and database tests", description: "Check endpoints, payloads and queries", href: "/docs/app/automate/api-test", icon: Braces },
        { title: "Load testing", description: "k6 scripts with live logs and run comparison", href: "/docs/app/automate/performance-test", icon: Gauge },
        { title: "Recorder", description: "Record a flow in Chrome or Edge, save it as a test", href: "/docs/recorder", icon: MousePointerClick },
        { title: "Requirements", description: "Link requirements to the tests that cover them", href: "/docs/app/automate/requirements", icon: ListChecks },
      ],
    },
    {
      title: "Monitor",
      items: [
        { title: "Uptime monitoring", description: "HTTP, website, SSL, ping and port checks", href: "/docs/app/monitor", icon: Globe },
        { title: "Synthetic monitoring", description: "Run a Playwright test on a schedule", href: "/docs/app/monitor#synthetic-monitor", icon: Workflow },
      ],
    },
    {
      title: "Communicate",
      items: [
        { title: "Alerts", description: "Email, Slack, Teams, Discord, Telegram and webhooks", href: "/docs/app/communicate/alerts", icon: Bell },
        { title: "Status pages", description: "Public pages with incidents and subscribers", href: "/docs/app/communicate/status-pages", icon: PanelsTopLeft },
      ],
    },
    {
      title: "Investigate",
      items: [
        { title: "Incidents", description: "One workspace for an incident and its alerts", href: "/docs/app/investigate/incidents", icon: Siren },
        { title: "AI SRE Copilot", description: "Read-only investigations that cite evidence", href: "/docs/app/investigate/copilot", icon: Bot },
        { title: "Connectors", description: "Prometheus, Grafana, Kubernetes, Sentry and more", href: "/docs/app/investigate/connectors", icon: Cable },
      ],
    },
  ],
};

export const solutionsMenu: NavMenu = {
  label: "Solutions",
  groups: [
    {
      title: "By role",
      items: [
        { title: "Developers", description: "Tests and monitors in your repo, deployed from CI", href: "/solutions/developers", icon: Code },
        { title: "SRE and platform", description: "Uptime, alerting and incident evidence in one place", href: "/solutions/sre", icon: Layers },
        { title: "QA engineers", description: "Record, run and schedule Playwright and k6 suites", href: "/solutions/qa", icon: ClipboardCheck },
        { title: "Engineering managers", description: "Coverage, ownership and access you can review", href: "/solutions/engineering-managers", icon: Users },
      ],
    },
  ],
};

export const developersMenu: NavMenu = {
  label: "Developers",
  groups: [
    {
      title: "Build with Supercheck",
      items: [
        { title: "Documentation", description: "Concepts, guides and setup", href: "/docs/app/welcome", icon: BookOpen },
        { title: "CLI", description: "Monitoring as code from your terminal", href: "/docs/cli", icon: Terminal },
        { title: "API reference", description: "REST endpoints for every resource", href: "/docs/api", icon: Braces },
        { title: "MCP server", description: "Let AI tools read your project", href: "/docs/mcp", icon: Sparkles },
        { title: "Self-hosting", description: "Run Supercheck on your own servers", href: "/docs/app/deployment/self-hosted", icon: Server },
        { title: "Releases", description: "Release notes on GitHub", href: `${GITHUB_URL}/releases`, icon: History },
      ],
    },
  ],
};

export const navMenus: NavMenu[] = [productMenu, solutionsMenu, developersMenu];

export const isExternal = (href: string) => href.startsWith("http");

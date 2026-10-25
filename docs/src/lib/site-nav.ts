import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BellRing,
  BookOpen,
  Bot,
  Braces,
  Chrome,
  ClipboardCheck,
  Code,
  Gauge,
  Globe,
  History,
  Layers,
  MousePointerClick,
  Plug,
  Server,
  Siren,
  Sparkles,
  Tally4,
  Target,
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
        { title: "Browser tests", description: "Playwright end-to-end tests", href: "/docs/app/automate/browser-test", icon: Chrome },
        { title: "API and database tests", description: "Endpoints, payloads and queries", href: "/docs/app/automate/api-test", icon: ArrowLeftRight },
        { title: "Load testing", description: "k6 with live logs and comparison", href: "/docs/app/automate/performance-test", icon: Gauge },
        { title: "Recorder", description: "Record flows in Chrome or Edge", href: "/docs/recorder", icon: MousePointerClick },
        { title: "Requirements", description: "Coverage for each requirement", href: "/docs/app/automate/requirements", icon: Target },
      ],
    },
    {
      title: "Monitor",
      items: [
        { title: "Uptime monitoring", description: "HTTP, website, SSL, ping and port", href: "/docs/app/monitor", icon: Globe },
        { title: "Synthetic monitoring", description: "Playwright tests on a schedule", href: "/docs/app/monitor#synthetic-monitor", icon: Workflow },
      ],
    },
    {
      title: "Communicate",
      items: [
        { title: "Alerts", description: "Slack, Teams, email and more", href: "/docs/app/communicate/alerts", icon: BellRing },
        { title: "Status pages", description: "Incidents and subscriber updates", href: "/docs/app/communicate/status-pages", icon: Tally4 },
      ],
    },
    {
      title: "Investigate",
      items: [
        { title: "Incidents", description: "Alerts and runs in one place", href: "/docs/app/investigate/incidents", icon: Siren },
        { title: "AI SRE Copilot", description: "Investigations that cite evidence", href: "/docs/app/investigate/copilot", icon: Bot },
        { title: "Connectors", description: "Prometheus, Grafana, Kubernetes", href: "/docs/app/investigate/connectors", icon: Plug },
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

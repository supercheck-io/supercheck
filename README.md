<h1><img src="./supercheck-logo.png" alt="Supercheck logo" width="40" height="40" align="top"> Supercheck</h1>

**Open-source testing, monitoring, and reliability as code.**

Supercheck brings Playwright test automation, k6 performance testing, uptime and synthetic monitoring, incident investigation, and public status communication into one platform. Use the web application, manage resources from the CLI, and record browser tests with the Supercheck Recorder.

[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Documentation](https://img.shields.io/badge/Docs-supercheck.io-blue)](https://supercheck.io/docs/app/welcome)
[![npm](https://img.shields.io/npm/v/@supercheck/cli?logo=npm&label=CLI)](https://www.npmjs.com/package/@supercheck/cli)
[![License](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

## What Supercheck includes

- **Test automation:** browser, API, database, custom, and k6 performance tests, with AI-assisted creation and failure analysis.
- **Monitoring:** HTTP, website and SSL, ping, port, and scheduled synthetic browser checks across configured execution locations.
- **Investigation:** run logs, screenshots, traces, linked artifacts, and read-only AI SRE investigation over Supercheck evidence and configured connectors.
- **Communication:** alerts through email, Slack, Discord, Telegram, Microsoft Teams, and webhooks, plus public status pages and subscriber notifications.
- **Governance:** organizations, projects, six RBAC roles, API keys, audit trails, requirements traceability, and coverage snapshots.
- **Secure execution:** ephemeral Kubernetes Jobs, gVisor isolation, network policies, and resource limits for Playwright and k6 workloads.

## Competitive landscape

Supercheck combines capabilities that are commonly split across test automation, synthetic monitoring, load testing, status communication, and incident-investigation products. The comparison below describes each product's primary, natively documented scope; integrations or adjacent products may extend it.

Pricing changes frequently, so the table links to each vendor's current official pricing or product page instead of copying amounts that can become stale. **Partial** means the capability is available only for a narrower use case or through an adjacent part of the vendor's platform. **—** means it is not a core, natively documented capability of the compared product.

| Platform | Primary focus | Pricing / model | Test automation | Synthetic / uptime | Load testing | Status pages | AI SRE / investigation | Unified Supercheck-style workflow | Self-hosted OSS | Notes |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| **Supercheck** | Unified reliability | Open-source, self-hosted | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Tests, monitors, k6, incidents, status communication, native evidence, and read-only AI SRE investigation in one platform. |
| [Checkly](https://www.checklyhq.com/pricing/) | Synthetic monitoring and continuous testing | Free and paid plans | ✅ | ✅ | — | ✅ | Partial | — | — | Playwright and API checks, monitoring as code, status pages, and check-focused analysis. |
| [Datadog Synthetic Monitoring](https://www.datadoghq.com/pricing/?product=synthetic-monitoring) | Observability and synthetics | Usage-based SaaS | Partial | ✅ | — | — | Partial | — | — | API and browser synthetics within the broader Datadog observability platform. |
| [Better Stack](https://betterstack.com/pricing) | Observability and incident management | Free and paid plans | — | ✅ | — | ✅ | Partial | — | — | Uptime monitoring, status pages, incident response, logs, metrics, traces, and AI-assisted operations. |
| [UptimeRobot](https://uptimerobot.com/pricing/) | Uptime monitoring | Free and paid plans | — | ✅ | — | ✅ | — | — | — | Uptime, endpoint, port, keyword, and status-page monitoring. |
| [BrowserStack](https://www.browserstack.com/pricing) | Browser and device testing cloud | Product and capacity-based SaaS | ✅ | Partial | — | — | Partial | — | — | Cross-browser and real-device testing, with separate observability and synthetic-monitoring products. |
| [Sauce Labs](https://saucelabs.com/pricing) | Browser and device testing cloud | Product and capacity-based SaaS | ✅ | Partial | — | — | Partial | — | — | Automated and manual browser/mobile testing with separate error reporting and insights capabilities. |
| [Cypress Cloud](https://www.cypress.io/pricing) | Cypress test orchestration | Free and paid plans | ✅ | — | — | — | Partial | — | — | CI orchestration, analytics, flake detection, and AI-assisted workflows for Cypress test suites. |
| [Grafana Cloud k6](https://grafana.com/pricing/) | Performance and load testing | Free and usage-based paid plans | — | Partial | ✅ | — | Partial | — | — | k6 load testing integrated with the wider Grafana Cloud observability stack. |
| [Azure Load Testing and Playwright Workspaces](https://azure.microsoft.com/en-us/pricing/details/app-testing/) | Cloud test execution | Usage-based cloud service | ✅ | — | ✅ | — | — | — | — | Managed Playwright browser testing and Apache JMeter-based load testing in Azure. |
| [Atlassian Statuspage](https://www.atlassian.com/software/statuspage/pricing) | Status communication | Free and paid plans | — | — | — | ✅ | — | — | — | Hosted status pages, incidents, components, and subscriber communication. |
| [Instatus](https://instatus.com/pricing) | Status pages and uptime | Free and paid plans | — | ✅ | — | ✅ | Partial | — | — | Hosted status pages, monitoring, incident communication, and operational tooling. |
| [HolmesGPT](https://github.com/HolmesGPT/holmesgpt) | AI SRE investigation | Open-source and commercial offerings | — | Partial | — | — | ✅ | — | ✅ | Open-source AI investigation using observability and infrastructure data; not a test or status-page platform. |
| [PagerDuty AIOps](https://www.pagerduty.com/platform/aiops/) | Event intelligence and incident response | Commercial SaaS | — | — | — | — | ✅ | — | — | Event correlation, triage, automation, and incident response built around signals from external systems. |
| [Resolve AI](https://resolve.ai/) | AI production operations | Commercial service | — | — | — | — | ✅ | — | — | AI agents focused on investigating and operating production systems rather than authoring and executing tests. |

## Get started

### Self-host Supercheck

Production self-hosting requires a Linux server with Docker Compose v2. Supercheck uses local K3s and gVisor for isolated test execution; macOS, Windows, and WSL2 are not supported deployment targets.

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker
sudo bash init-secrets.sh
sudo bash setup-k3s.sh
KUBECONFIG_FILE=/etc/rancher/k3s/supercheck-worker.kubeconfig docker compose up -d
```

Open `http://localhost:3000`, or follow the [self-hosting guide](https://supercheck.io/docs/app/deployment/self-hosted) to configure HTTPS, optional integrations, backups, and multi-location workers.

### Install the CLI

The CLI requires Node.js 20 or later.

```bash
npm install -g @supercheck/cli
supercheck init
```

Create a token under **Organization Admin > CLI Tokens**, then authenticate:

```bash
supercheck login --token sck_live_...
supercheck pull
supercheck diff
supercheck deploy
```

See the [CLI guide](cli/) and [command reference](https://supercheck.io/docs/cli/commands) for resource management, local execution, and CI/CD usage.

### Install the recorder

Record browser interactions and save Playwright tests directly to Supercheck:

- [Chrome Web Store](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/0rdckc265vb9)
- [Source and build instructions](recorder/)
- [Recorder documentation](https://supercheck.io/docs/recorder)

## Architecture

```mermaid
flowchart TB
    Users[Users / CI/CD] --> T[Traefik Proxy<br/>SSL / Load Balancer]
    T --> App[Next.js App<br/>UI + API]
    App --> DB[(PostgreSQL<br/>Primary DB)] & Redis[(Redis + BullMQ<br/>Queue + Cache)] & S3[(MinIO<br/>Artifacts)]

    Redis --> W_EU
    Redis -.->|Internet| W_US
    Redis -.->|Internet| W_APAC

    subgraph PRIMARY["Primary Server"]
        W_EU[Worker EU<br/>NestJS + BullMQ<br/>WORKER_LOCATION=eu-central] --> K3S_EU[K3s + gVisor<br/>Sandboxed Execution]
    end

    subgraph US["US Server"]
        W_US[Worker US<br/>NestJS + BullMQ<br/>WORKER_LOCATION=us-east] --> K3S_US[K3s + gVisor<br/>Sandboxed Execution]
    end

    subgraph APAC["Asia Pacific Server"]
        W_APAC[Worker APAC<br/>NestJS + BullMQ<br/>WORKER_LOCATION=asia-pacific] --> K3S_APAC[K3s + gVisor<br/>Sandboxed Execution]
    end

    style Users fill:#6366f1,stroke:#4338ca,color:#fff
    style T fill:#0ea5e9,stroke:#0369a1,color:#fff
    style App fill:#3b82f6,stroke:#1e40af,color:#fff
    style DB fill:#f59e0b,stroke:#b45309,color:#fff
    style Redis fill:#ef4444,stroke:#b91c1c,color:#fff
    style S3 fill:#8b5cf6,stroke:#6d28d9,color:#fff
    style W_EU fill:#10b981,stroke:#047857,color:#fff
    style W_US fill:#10b981,stroke:#047857,color:#fff
    style W_APAC fill:#10b981,stroke:#047857,color:#fff
    style K3S_EU fill:#059669,stroke:#047857,color:#fff
    style K3S_US fill:#059669,stroke:#047857,color:#fff
    style K3S_APAC fill:#059669,stroke:#047857,color:#fff
    style PRIMARY fill:none,stroke:#3b82f6,stroke-width:2px
    style US fill:none,stroke:#64748b,stroke-width:2px,stroke-dasharray: 5 5
    style APAC fill:none,stroke:#64748b,stroke-width:2px,stroke-dasharray: 5 5
```

The application stores platform data in PostgreSQL, schedules work through Redis and BullMQ, and keeps execution artifacts in S3-compatible storage such as MinIO. Workers consume location-aware queues and run Playwright or k6 workloads as ephemeral Kubernetes Jobs in a restricted execution namespace. Deploy one local worker or add workers for other configured locations.

## Repository layout

| Path | Purpose | License |
| --- | --- | --- |
| [`app/`](app/) | Next.js web application and API | AGPL-3.0-only |
| [`worker/`](worker/) | NestJS orchestration and execution worker | AGPL-3.0-only |
| [`cli/`](cli/) | `@supercheck/cli` source and documentation | AGPL-3.0-only |
| [`recorder/`](recorder/) | Browser recorder based on Playwright CRX | Apache-2.0 |
| [`docs/`](docs/) | Product and deployment documentation | AGPL-3.0-only |
| [`deploy/`](deploy/) | Docker Compose and Kubernetes deployment assets | AGPL-3.0-only |

## Documentation

- [Welcome](https://supercheck.io/docs/app/welcome)
- [Deployment](https://supercheck.io/docs/app/deployment)
- [Automate: tests, jobs, and runs](https://supercheck.io/docs/app/automate)
- [Monitor](https://supercheck.io/docs/app/monitor)
- [Investigate with AI SRE](https://supercheck.io/docs/app/investigate)
- [Communicate: alerts and status pages](https://supercheck.io/docs/app/communicate)
- [Administration](https://supercheck.io/docs/app/admin)
- [CLI](https://supercheck.io/docs/cli/commands)
- [Recorder](https://supercheck.io/docs/recorder)

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use [GitHub Issues](https://github.com/supercheck-io/supercheck/issues) for reproducible bugs and [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions) for proposals and questions.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Community integrations

| Integration | Description |
| --- | --- |
| [Azure DevOps](https://marketplace.visualstudio.com/items?itemName=ClinicalSupportSystems.supercheck-integration) | Community-maintained pipeline tasks and dashboard widget |

Community integrations are maintained outside the core Supercheck repository. If you have built one, open a [Discussion](https://github.com/supercheck-io/supercheck/discussions) to share it.

## License

The Supercheck app, worker, CLI, documentation, and deployment assets are licensed under the [GNU Affero General Public License v3.0 only](LICENSE). The recorder remains Apache-2.0; see [`recorder/LICENSE`](recorder/LICENSE), [`recorder/NOTICE`](recorder/NOTICE), and its retained upstream attribution.

## Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/UVe327CSbm)
[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/issues)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/discussions)

<h1><img src="./supercheck-logo.png" alt="Supercheck Logo" width="40" height="40" align="top"> Supercheck</h1>

**Open-Source Testing, Monitoring, and Reliability — as Code**

The unified platform for AI-powered Playwright testing, multi-region k6 load testing, uptime monitoring, and subscriber-ready status pages.

[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Self-Host](https://img.shields.io/badge/Self--Host-Docker%20Compose%20+%20K3s-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/app/deployment/self-hosted)
[![npm](https://img.shields.io/npm/v/@supercheck/cli?logo=npm&label=Supercheck%20CLI)](https://www.npmjs.com/package/@supercheck/cli)
[![Testing](https://img.shields.io/badge/Testing-Playwright-45ba4b?logo=googlechrome&logoColor=white)](https://playwright.dev)
[![Load Testing](https://img.shields.io/badge/Load%20Testing-Grafana%20k6-7D64FF?logo=k6)](https://k6.io)
[![AI](https://img.shields.io/badge/AI-Enabled-blueviolet?logo=openai&logoColor=white)](https://supercheck.io)

## Why Supercheck?

Supercheck combines **test automation**, **synthetic + uptime monitoring**, **performance testing**, and **status communication** in one self-hosted platform.

### Competitive landscape

| Category | Platform | Pricing (public) | Notes |
|----------|----------|------------------|-------|
| **Monitoring** | Checkly | Free tier; Starter: $24/mo; Team: $64/mo | Playwright-based; Browser checks are metered & expensive at scale |
| **Monitoring** | Datadog | API: $5/10k runs; Browser: $12/1k runs | High volume costs; complex enterprise pricing model |
| **Monitoring** | Pingdom | Syn: $10/mo (10 checks); $15/10k runs | Legacy incumbent; limited modern browser automation features |
| **Monitoring** | Better Stack | Free tier; Pro: $29/mo + usage | Focuses on incident management & pages; limited testing |
| **Monitoring** | UptimeRobot | Free tier; Solo: $7/mo; Team: $29/mo | Basic uptime focus; limited synthetic capabilities |
| **Automation** | BrowserStack | Desktop: $129/mo; Mobile: $199/mo | Pricing per parallel thread; becomes costly for high concurrency |
| **Automation** | Sauce Labs | Virtual Cloud: $149/mo (1 parallel) | Similar to BrowserStack; expensive for parallel execution |
| **Automation** | LambdaTest | Web: $79/mo (1 parallel); Pro: $158/mo | Cheaper than competitors but still costly for scaling parallelism |
| **Automation** | Cypress Cloud | Free tier; Team: $67/mo; Business: $267/mo | Test orchestration only; requires separate infrastructure |
| **Performance** | Grafana k6 | Free (500 VUH); Pro: $29/mo (500 VUH) | Usage-based (Virtual User Hours); enterprise is custom |
| **Performance** | BlazeMeter | Basic: $99/mo; Pro: $499/mo | Enterprise-grade JMeter/Taurus; high entry cost for Pro features |
| **Performance** | Gatling | Basic: €89/mo (~$95); Team: €396/mo | Scala/Java/JS based; expensive for team collaboration features |
| **Performance** | Azure Test | $0.15/VUH (first 10k), then $0.06/VUH | Usage-only pricing; complex Azure infrastructure setup |
| **Status** | Statuspage | Free tier; Startup: $99/mo; Business: $399/mo | The industry standard (Atlassian); expensive for business features |
| **Status** | Instatus | Free tier; Pro: $20/mo; Business: $300/mo | Modern alternative; "Business" tier jump is steep ($20 -> $300) |
| **All-in-one** | **Supercheck** | **Open-source, self-hosted** | **Unified Tests, Monitors, Load, & Status Pages in one platform** |

## Features

### Test Automation

- **Browser Tests** — Playwright UI automation with screenshots, traces, and video
- **API Tests** — HTTP/GraphQL request + response validation
- **Database Tests** — SQL/DB validation workflows in custom test scripts
- **Performance Tests** — k6 load testing with regional execution support
- **Custom Tests** — Node.js-based custom test logic

### Monitoring

- **HTTP / Website** — Endpoint monitoring with SSL certificate tracking
- **Ping / Port** — Network-level availability checks
- **Synthetic Monitors** — Scheduled Playwright browser journeys
- **Multi-Region** — US East, EU Central, Asia Pacific execution options

### AI Workflows

- **AI Create** — Generate tests from natural language
- **AI Fix** — Analyze failures and propose fixes
- **AI Analyze** — Analyze monitor, job, and performance run outcomes

### Debugging & Reporting

- **Screenshots, traces, video, and logs** for fast failure diagnosis
- **Report artifacts** stored in object storage with run linkage

### Communication

- **Alerts** — Email, Slack, Discord, Telegram, Teams, and Webhooks
- **Status Pages** — Public-facing service status with incident workflows
- **Dashboards** — Real-time visibility into run and monitor health

### Administration & Governance

- **Organizations + Projects** — Multi-tenant workspace model
- **RBAC** — 6 role levels from `super_admin` to `project_viewer`
- **API Keys** — Programmatic access
- **Audit Trails** — Change and action history

### Execution Security

- **gVisor Sandboxing** — Test execution runs in ephemeral Kubernetes Jobs under gVisor for kernel-level syscall isolation
- **Network Segmentation** — Execution pods are restricted from accessing internal services and cloud metadata endpoints
- **Resource Quotas** — Per-namespace limits prevent runaway test pods from exhausting cluster resources

### Requirements Management

- **AI extraction** from requirement documents (PDF, DOCX, text)
- **Coverage snapshots** linked to test execution outcomes
- **Requirement-to-test linking** with traceability metadata

### Browser Extensions

Record Playwright tests directly from your browser:

- [Chrome Extension](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
- [Edge Extension](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)

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

Each server runs its own local [K3s](https://k3s.io) cluster with [gVisor](https://gvisor.dev/) sandboxing. Workers consume jobs from Redis via BullMQ and execute each test as an ephemeral Kubernetes Job in a sandboxed execution namespace. Remote workers connect to the primary server's Redis, PostgreSQL, and MinIO over the network. Deploy workers in a [single location](https://supercheck.io/docs/app/deployment/self-hosted) or across [multiple regions](https://supercheck.io/docs/app/deployment/multi-location).

## Deployment

Self-host Supercheck on your own infrastructure. Docker Compose handles the app, worker, and data services while a local K3s cluster provides gVisor-sandboxed test execution:

| Option | Description | Guide |
|--------|-------------|-------|
| [![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose%20+%20K3s-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/app/deployment/self-hosted) | Docker Compose + K3s self-hosted deployment | [Read guide](https://supercheck.io/docs/app/deployment/self-hosted) |

## Documentation

Official docs:

- [Welcome](https://supercheck.io/docs/app/welcome)
- [Deployment](https://supercheck.io/docs/app/deployment)
- [Automate (Tests, Jobs, Runs)](https://supercheck.io/docs/app/automate)
- [Monitor](https://supercheck.io/docs/app/monitor)
- [Communicate (Alerts, Status Pages)](https://supercheck.io/docs/app/communicate)
- [Admin](https://supercheck.io/docs/app/admin)
- [CLI Reference](https://supercheck.io/docs/app/cli)

## Supercheck CLI

Install and manage Supercheck resources from the command line with `@supercheck/cli`:

- [npm package](https://www.npmjs.com/package/@supercheck/cli)

## Community Integrations

Community-built tools and extensions that extend Supercheck:

| Integration | Description |
|-------------|-------------|
| [Azure DevOps](https://marketplace.visualstudio.com/items?itemName=ClinicalSupportSystems.supercheck-integration) | Azure DevOps pipeline tasks (Trigger Job, Deploy Config, Health Check, Pause/Resume Monitors) and a dashboard widget |

This extension is community-built and maintained outside the core Supercheck repository.

> Built an integration? Open a [Discussion](https://github.com/supercheck-io/supercheck/discussions) and we'll add it here.

## Support

If Supercheck is useful to your team:

- ⭐ Star this repository
- 💡 Suggest features in [Discussions](https://github.com/supercheck-io/supercheck/discussions)
- 🐞 Report issues in [Issues](https://github.com/supercheck-io/supercheck/issues)

## Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/UVe327CSbm)
[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/issues)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/discussions)




<h1><img src="./supercheck-logo.png" alt="Supercheck Logo" width="40" height="40" align="top"> Supercheck</h1>

**Open-Source Testing, Monitoring, and Reliability — as Code**

The unified platform for AI-powered Playwright testing, multi-region k6 load testing & uptime monitoring, and subscriber-ready status pages.


[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Deploy with Coolify](https://img.shields.io/badge/Deploy%20with-Coolify-6B16ED?logo=coolify&logoColor=white)](./deploy/coolify/README.md)
[![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/deployment)
[![npm](https://img.shields.io/npm/v/@supercheck/cli?logo=npm&label=Supercheck%20CLI)](https://www.npmjs.com/package/@supercheck/cli)
[![Monitoring](https://img.shields.io/badge/Synthetic-Monitor-brightgreen?logo=speedtest&logoColor=white)](https://supercheck.io)
[![Testing](https://img.shields.io/badge/Testing-Playwright-45ba4b?logo=googlechrome&logoColor=white)](https://playwright.dev)
[![Load Testing](https://img.shields.io/badge/Load%20Testing-Grafana%20k6-7D64FF?logo=k6)](https://k6.io)
[![AI](https://img.shields.io/badge/AI-Enabled-blueviolet?logo=openai&logoColor=white)](https://supercheck.io)
[![Google CodeWiki](https://img.shields.io/badge/Google-CodeWiki-4285F4?logo=google&logoColor=white)](https://codewiki.google/github.com/supercheck-io/supercheck)

## Why Supercheck?

### The Landscape

| Category | Platform | Pricing | Limitations |
|----------|----------|---------|-------------|
| Monitoring | Datadog Synthetics | $12/1K browser runs | High cost at scale; no native Playwright |
| Monitoring | Checkly | $24–64/mo + overages | Per-run overage fees; limited to their cloud |
| Monitoring | Dynatrace Synthetic | $4.50/1K actions | Complex "action" pricing; proprietary scripting |
| Automation | BrowserStack | From $129/mo (annual) | High parallelism tax; 1 thread per license |
| Automation | Sauce Labs | $149–249/mo per parallel | Strict concurrency limits; vendor lock-in |
| Automation | Cypress Cloud | $67–267/mo | +$6/1K result overages; Cypress-only ecosystem |
| Automation | LambdaTest | From ~$99/mo | Session timeouts; data on their cloud |
| Automation | Azure App Testing | $0.01/min + $3.50/1K results | Reporting fees add up; Azure lock-in |
| Performance | Grafana k6 Cloud | $0.15/VUh | Pay-per-scale; cloud-only execution |
| Performance | LoadRunner Cloud | $0.15–1.50/VUh | Complex licensing; expensive GUI user pricing |
| Performance | Gatling Enterprise | From €89/mo | User/generator limits on lower tiers |
| All-in-one | **Supercheck** | **Free (Open Source)** | Self-hosted; requires own infrastructure |

## Features

### Test Automation

- **Browser Tests** — Playwright-based UI testing with screenshots, traces, and video recordings
- **API Tests** — HTTP/GraphQL validation with request/response assertions
- **Database Tests** — SQL queries against PostgreSQL, MySQL with result validation
- **Performance Tests** — k6 load testing with multi-region load generators (US, EU, APAC)
- **Custom Tests** — Node.js scripts for any testing scenario

### Monitoring
- **HTTP / Website** — Endpoint availability with SSL certificate tracking
- **Ping / Port** — Network-level checks for servers and services
- **Synthetic Monitors** — Full Playwright tests running on a schedule
- **Multi-Region** — Execute from US East, EU Central, and Asia Pacific

### CI/CD Integration
- **API Triggers** — Trigger jobs from GitHub Actions, GitLab CI, or any pipeline
- **Scheduled Jobs** — Cron-based scheduling for regression suites
- **Webhook Notifications** — Send results to Slack, Discord, Teams, or custom endpoints

### AI-Powered
- **AI Create** — Generate test scripts from plain English descriptions
- **AI Fix** — Analyze failures and suggest code fixes automatically
- **AI Analyze** — Performance insights comparing test runs

### Debugging & Reports
- **Screenshots** — Captured at each step and on failure
- **Traces** — Interactive step-by-step replay with DOM inspection
- **Videos** — Full browser session recordings
- **Network Logs** — Request/response details for debugging

### Communication
- **Alerts** — Email, Slack, Discord, Telegram, Teams, Webhooks with threshold-based triggers
- **Status Pages** — Branded public pages with incident management
- **Dashboards** — Real-time visibility into test and monitor health

### Administration
- **Organizations** — Multi-tenant team management
- **RBAC** — 6 permission levels from viewer to super admin
- **API Keys** — Secure programmatic access
- **Audit Trails** — Track all changes for compliance

### Requirements Management
- **AI Extraction** — Extract requirements from PRDs, PDFs, and DOCX
- **Computed Coverage** — Status derived from linked test executions
- **Test Linking** — Many-to-many relationships between requirements and tests
- **Source Traceability** — Track original document source for each requirement

### Browser Extensions
Record Playwright tests directly from your browser:
- [Chrome Extension](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)
- [Edge Extension](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)

## Architecture

```
                              ┌──────────────────────┐
                              │   Users / CI/CD      │
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼───────────┐
                              │   Traefik Proxy      │
                              │   (SSL / LB)         │
                              └──────────┬───────────┘
                                         │
                              ┌──────────▼───────────┐
                              │   Next.js App        │
                              │   (UI + API)         │
                              └──────────┬───────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
┌─────────▼─────────┐         ┌──────────▼───────────┐       ┌──────────▼─────────┐
│    PostgreSQL     │         │   Redis + BullMQ     │       │   MinIO Storage    │
│   (Primary DB)    │         │   (Queue + Cache)    │       │   (Artifacts)      │
└───────────────────┘         └──────────┬───────────┘       └────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
          ┌─────────▼─────────┐ ┌────────▼────────┐ ┌─────────▼─────────┐
          │  NestJS Worker 1  │ │ NestJS Worker 2 │ │  NestJS Worker N  │
          │  ┌─────────────┐  │ │ ┌─────────────┐ │ │  ┌─────────────┐  │
          │  │ Playwright  │  │ │ │ Playwright  │ │ │  │ Playwright  │  │
          │  │ k6 Load     │  │ │ │ k6 Load     │ │ │  │ k6 Load     │  │
          │  │ Monitors    │  │ │ │ Monitors    │ │ │  │ Monitors    │  │
          │  └─────────────┘  │ │ └─────────────┘ │ │  └─────────────┘  │
          └───────────────────┘ └─────────────────┘ └───────────────────┘
```

## Deployment

Self-host Supercheck on your own infrastructure:

| Option | Description | Guide |
|--------|-------------|-------|
| [![Deploy with Coolify](https://img.shields.io/badge/Deploy%20with-Coolify-6B16ED?logo=coolify&logoColor=white)](./deploy/coolify/README.md) | One-click deploy on [Coolify](https://coolify.io) | [Read Guide ↗](./deploy/coolify/README.md) |
| [![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/deployment) | Manual deployment with Docker | [Read Guide ↗](https://supercheck.io/docs/deployment) |

## Documentation

Full documentation available at **[supercheck.io/docs](https://supercheck.io/docs)**

| Topic | Description |
|-------|-------------|
| [Automate](https://supercheck.io/docs/automate) | Browser, API, database, and performance tests |
| [Monitor](https://supercheck.io/docs/monitors) | HTTP, ping, port, and synthetic monitoring |
| [Communicate](https://supercheck.io/docs/communicate) | Alerts, dashboards, and status pages |
| [Admin](https://supercheck.io/docs/admin) | User management, RBAC, and audit trails |
| [CLI](https://supercheck.io/docs/cli) | Monitoring-as-code, CI/CD workflows, and CLI reference |

## Supercheck CLI

Install and manage Supercheck resources from the command line with `@supercheck/cli`.

- [npm package](https://www.npmjs.com/package/@supercheck/cli)
- [CLI docs](https://supercheck.io/docs/cli)


## Support

If you find Supercheck useful, please consider:

- ⭐ **Star this repository** — it helps others discover the project
- 💡 **Suggest features** — start a [discussion](https://github.com/supercheck-io/supercheck/discussions)
- 📢 **Spread the word** — share with others

## Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/UVe327CSbm)
<br>
[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/issues)
<br>
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/discussions)




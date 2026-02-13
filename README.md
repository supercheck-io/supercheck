<h1><img src="./supercheck-logo.png" alt="Supercheck Logo" width="40" height="40" align="top"> Supercheck</h1>

**Open-Source Testing, Monitoring, and Reliability — as Code**

The unified platform for AI-powered Playwright testing, multi-region k6 load testing, uptime monitoring, and subscriber-ready status pages.

[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Deploy with Coolify](https://img.shields.io/badge/Deploy%20with-Coolify-6B16ED?logo=coolify&logoColor=white)](./deploy/coolify/README.md)
[![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/app/deployment/self-hosted)
[![npm](https://img.shields.io/npm/v/@supercheck/cli?logo=npm&label=Supercheck%20CLI)](https://www.npmjs.com/package/@supercheck/cli)
[![Testing](https://img.shields.io/badge/Testing-Playwright-45ba4b?logo=googlechrome&logoColor=white)](https://playwright.dev)
[![Load Testing](https://img.shields.io/badge/Load%20Testing-Grafana%20k6-7D64FF?logo=k6)](https://k6.io)
[![AI](https://img.shields.io/badge/AI-Enabled-blueviolet?logo=openai&logoColor=white)](https://supercheck.io)

## Why Supercheck?

Supercheck combines **test automation**, **synthetic + uptime monitoring**, **performance testing**, and **status communication** in one self-hosted platform.

### Competitive landscape (pricing snapshot)

| Category | Platform | Pricing (public) | Notes |
|----------|----------|------------------|-------|
| Monitoring | Checkly | Hobby: $0/mo; Starter: $24/mo; Team: $64/mo; Browser overage: $6.50/1k (Starter) or $6.25/1k (Team) | Native Playwright checks; API/browser checks are metered ([source](https://www.checklyhq.com/pricing/)) |
| Monitoring | Grafana Cloud Synthetics | API checks: $5 per 10k; Browser checks: $50 per 10k (plus platform fee on paid plan) | Also includes free usage tier ([source](https://grafana.com/pricing/)) |
| Monitoring | Better Stack | Free: $0/mo; paid uptime responder license from $29/mo; Playwright transaction monitoring listed as $1 per 100 minutes | Combines uptime, incident management, and transaction monitoring ([source](https://betterstack.com/pricing)) |
| Monitoring | UptimeRobot | Free: $0/mo; Solo: $7/mo (annual); Team: $29/mo (annual); Enterprise: $54/mo (annual) | Uptime-focused (HTTP, ping, port, keyword, DNS, SSL) ([source](https://uptimerobot.com/pricing/)) |
| Automation | BrowserStack | Live manual testing: $29/mo (desktop, annual), $39/mo (desktop + mobile, annual), Team from $150/mo (annual) | Pricing varies by product and team size ([source](https://www.browserstack.com/pricing)) |
| Automation | Sauce Labs | Virtual Cloud: $149/mo annually (1 parallel); Real Device Cloud: $199/mo annually (1 parallel) | Parallel sessions scale with plan tier ([source](https://saucelabs.com/pricing)) |
| Automation | Cypress Cloud | Team: $67/mo (annual); Business: $267/mo (annual); overages from $5–$6 per 1k results | Free starter tier available ([source](https://www.cypress.io/pricing)) |
| Automation + Performance | Azure App Testing | Playwright Linux browsers: $0.01/min; Windows browsers: $0.02/min; Load testing: $0.15/VUH (first 10k), then $0.06/VUH | Usage-based Azure service pricing ([source](https://azure.microsoft.com/en-us/pricing/details/app-testing/)) |
| Performance | Grafana k6 Cloud | Starts at $0.15 per virtual user hour (VUH); enterprise as low as $0.05/VUH with annual commit | Includes free tier with 500 VUH/month ([source](https://grafana.com/pricing/)) |
| All-in-one | **Supercheck** | **Open-source, self-hosted** | Includes tests, monitors, performance, alerts, status pages, and AI workflows |

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

### Requirements Management

- **AI extraction** from requirement documents (PDF, DOCX, text)
- **Coverage snapshots** linked to test execution outcomes
- **Requirement-to-test linking** with traceability metadata

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
| [![Deploy with Coolify](https://img.shields.io/badge/Deploy%20with-Coolify-6B16ED?logo=coolify&logoColor=white)](./deploy/coolify/README.md) | One-click deployment on [Coolify](https://coolify.io) | [Read guide](./deploy/coolify/README.md) |
| [![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/app/deployment/self-hosted) | Docker Compose self-hosted deployment | [Read guide](https://supercheck.io/docs/app/deployment/self-hosted) |

## Documentation

Official docs:

- [Welcome](https://supercheck.io/docs/app/welcome)
- [Deployment](https://supercheck.io/docs/app/deployment)
- [Automate (Tests, Jobs, Runs)](https://supercheck.io/docs/app/automate)
- [Monitor](https://supercheck.io/docs/app/monitor)
- [Communicate (Alerts, Status Pages)](https://supercheck.io/docs/app/communicate)
- [Admin](https://supercheck.io/docs/app/admin)

## Supercheck CLI

Install and manage Supercheck resources from the command line with `@supercheck/cli`:

- [npm package](https://www.npmjs.com/package/@supercheck/cli)

## Support

If Supercheck is useful to your team:

- ⭐ Star this repository
- 💡 Suggest features in [Discussions](https://github.com/supercheck-io/supercheck/discussions)
- 🐞 Report issues in [Issues](https://github.com/supercheck-io/supercheck/issues)

## Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/UVe327CSbm)
[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/issues)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/discussions)




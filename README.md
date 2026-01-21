<h1><img src="./supercheck-logo.png" alt="Supercheck Logo" width="40" height="40" align="top"> Supercheck</h1>

**Open Source AI-Powered Test Automation & Monitoring Platform**

Empowering development and SRE teams with a scalable, distributed, and robust platform to drive faster delivery and higher software quality.

[![Deploy with Coolify](https://img.shields.io/badge/Deploy%20with-Coolify-6B16ED?logo=coolify&logoColor=white)](./deploy/coolify/README.md)
[![Deploy with Docker](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-2496ED?logo=docker&logoColor=white)](https://supercheck.io/docs/deployment)
[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Monitoring](https://img.shields.io/badge/Synthetic-Monitor-brightgreen?logo=speedtest&logoColor=white)](https://supercheck.io)
[![Testing](https://img.shields.io/badge/Testing-Playwright-45ba4b?logo=googlechrome&logoColor=white)](https://playwright.dev)
[![Load Testing](https://img.shields.io/badge/Load%20Testing-Grafana%20k6-7D64FF?logo=k6)](https://k6.io)
[![AI](https://img.shields.io/badge/AI-Enabled-blueviolet?logo=openai&logoColor=white)](https://supercheck.io)
[![Google CodeWiki](https://img.shields.io/badge/Google-CodeWiki-4285F4?logo=google&logoColor=white)](https://codewiki.google/github.com/supercheck-io/supercheck)


## Features

**Automate** — Browser (Playwright), API, database, and performance (k6) tests with AI-powered test creation and fix

**Extension** — Record Playwright end-to-end tests directly from your browser using our Browser Extensions for [Chrome](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe) and [Edge](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)

**Monitor** — HTTP, website, ping, port, and synthetic monitors from multiple geographic regions

**Communicate** — Alerts (Email, Slack, Discord, Telegram, Webhooks), dashboards, and public status pages

**Admin** — Multi-tenant organizations, RBAC with 6 permission levels, API keys, and audit trails

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



## Community

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/UVe327CSbm)
[![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/issues)
[![GitHub Discussions](https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white)](https://github.com/supercheck-io/supercheck/discussions)


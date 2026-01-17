# <img src="./supercheck-logo.png" alt="Supercheck Logo" width="36" height="36" style="vertical-align: middle; margin-right: 2px;"> Supercheck

**Open Source AI-Powered Test Automation & Monitoring Platform**

Empowering development and SRE teams with a scalable, distributed, and robust platform to drive faster delivery and higher software quality.

[![Deploy](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-blue?logo=docker)](./deploy/docker/docker-compose.yml)
[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?logo=docker)](https://supercheck.io)
[![Monitoring](https://img.shields.io/badge/Synthetic-Monitor-brightgreen?logo=speedtest&logoColor=white)](https://supercheck.io)
[![Testing](https://img.shields.io/badge/Testing-Playwright-45ba4b?logo=googlechrome&logoColor=white)](https://playwright.dev)
[![Load Testing](https://img.shields.io/badge/Load%20Testing-Grafana%20k6-7D64FF?logo=k6)](https://k6.io)
[![AI](https://img.shields.io/badge/AI-Enabled-blueviolet?logo=openai&logoColor=white)](https://supercheck.io)
[![Google CodeWiki](https://img.shields.io/badge/Google-CodeWiki-4285F4?logo=google&logoColor=white)](https://codewiki.google/github.com/supercheck-io/supercheck)

## Features

**Automate** — Browser (Playwright), API, database, and performance (k6) tests with AI-powered test creation and fix

**Extension** — Record Playwright end-to-end tests directly from your browser using our [Browser Extension](https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe)

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

**Stack**: [Next.js 16](https://github.com/vercel/next.js) · [React 19](https://github.com/facebook/react) · [NestJS](https://github.com/nestjs/nest) · [Playwright](https://github.com/microsoft/playwright) · [Grafana k6](https://github.com/grafana/k6) · [PostgreSQL](https://github.com/postgres/postgres) · [Redis](https://github.com/redis/redis) · [MinIO](https://github.com/minio/minio) · [BullMQ](https://github.com/taskforcesh/bullmq)
 
## Documentation

Full documentation available at **[supercheck.io/docs](https://supercheck.io/docs)**

| Topic | Description |
|-------|-------------|
| [Deployment](https://supercheck.io/docs/deployment) | Self-host with Docker Compose |
| [Automate](https://supercheck.io/docs/automate) | Browser, API, and database tests |
| [Monitor](https://supercheck.io/docs/monitors) | HTTP, ping, port, and synthetic monitoring |
| [Communicate](https://supercheck.io/docs/communicate) | Alerts, dashboards, and status pages |
| [Admin](https://supercheck.io/docs/admin) | User management, RBAC, and audit trails |


## Community

- [GitHub Issues](https://github.com/supercheck-io/supercheck/issues)
- [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)
- [Security](SECURITY.md) — Vulnerability reporting


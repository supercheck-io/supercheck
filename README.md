<img src="./supercheck-logo.png" alt="Supercheck Logo" width="75">

# Supercheck

**Enterprise-grade automation and monitoring platform for modern applications.**

Supercheck delivers comprehensive test automation, real-time monitoring, intelligent job orchestration, and parallel execution capabilities for development and SRE teams.

[![Deploy](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-blue?logo=docker)](./docker-compose.yml)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?logo=docker)](https://supercheck.io)
[![Monitoring](https://img.shields.io/badge/Monitoring-Real--time-brightgreen?logo=grafana)](https://supercheck.io)
[![Testing](https://img.shields.io/badge/Testing-Playwright-red?logo=playwright)](https://playwright.dev)

## Features

**Testing & Automation**
- Browser (Playwright), API, Database, and custom script execution
- Interactive code playground with built-in editor
- Cron-based scheduled jobs with parallel execution
- AI-powered failure analysis and fix suggestions

**Monitoring**
- Synthetic tests, HTTP/HTTPS, Website, Ping, and Port monitoring
- Multi-location execution across 3 geographic regions
- SSL certificate tracking and validation
- Historical performance metrics

**Status Pages**
- Public status pages with custom branding
- Incident management and tracking
- Email and webhook notifications
- Scheduled maintenance announcements

**Alerting**
- Multi-channel: Email, Slack, Webhooks, Telegram, Discord
- Configurable failure/recovery thresholds
- Monitor failures, SSL expiration, job alerts

**Access Control**
- Multi-tenant organizations and projects
- RBAC with 6 permission levels
- API keys and audit logging

## Architecture

```
┌─────────────────────────┐
│   Next.js App Service   │
│  Frontend + API Routes  │
└───────────┬─────────────┘
            │
    ┌───────┼────────┬──────────┐
    ↓       ↓        ↓          ↓
┌────────┐ ┌─────┐ ┌──────┐ ┌────────────┐
│Postgres│ │Redis│ │MinIO │ │NestJS Workers│
└────────┘ └─────┘ └──────┘ └────────────┘
```

**Stack**: Next.js · React · NestJS · PostgreSQL · Redis · MinIO · Playwright

## Quick Start

```bash
# Clone and setup
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck
cp .env.example .env

# Start with Docker
docker-compose up -d
docker-compose exec app npm run setup:admin admin@example.com
```

Access at `http://localhost:3000`

## Development

**Prerequisites**: Node.js 20+ · Docker

**Local Development**:
```bash
# App service
cd app && npm install && npm run db:migrate && npm run dev

# Worker service
cd worker && npm install && npm run dev
```

**Project Structure**:
```
supercheck/
├── app/          # Next.js frontend & API
├── worker/       # NestJS worker service
├── docs/         # Documentation site
└── docker-compose.yml
```

## Documentation

- [Contributing](CONTRIBUTING.md) - Development guidelines
- [Code of Conduct](CODE_OF_CONDUCT.md) - Community standards
- [Support](SUPPORT.md) - Getting help
- [Security](SECURITY.md) - Vulnerability reporting

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Community

- [GitHub Issues](https://github.com/supercheck-io/supercheck/issues)
- [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)

## License

MIT License - see [LICENSE](LICENSE) for details.

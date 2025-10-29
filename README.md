<img src="./supercheck-logo.png" alt="Supercheck Logo" width="75">

# Supercheck

**Automation & Monitoring Platform for Modern Applications**

[Supercheck](https://supercheck.io) is an enterprise-grade distributed platform engineered for scalability and reliability at scale. It delivers comprehensive test automation with real-time monitoring, intelligent job orchestration, and parallel execution capabilities, empowering development and SRE teams with a robust solution to accelerate software quality and delivery cycles.

[![Deploy](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-blue?logo=docker)](./docker-compose.yml)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Website](https://img.shields.io/badge/Website-supercheck.io-orange?logo=firefox)](https://supercheck.io)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?logo=docker)](https://supercheck.io)
[![Monitoring](https://img.shields.io/badge/Monitoring-Real--time-brightgreen?logo=grafana)](https://supercheck.io)
[![Testing](https://img.shields.io/badge/Testing-Playwright-red?logo=playwright)](https://playwright.dev)

---

## Overview

Supercheck is an open-source platform for automated testing, multi-location monitoring, and status communication. It combines Playwright-based end-to-end testing with distributed monitoring capabilities across multiple geographic regions.

**Key Capabilities:**

- Automated testing (Browser, API, Database, Custom)
- Multi-location monitoring (US East, EU Central, Asia Pacific etc.)
- Public status pages with incident management
- AI-powered test failure analysis
- Multi-channel alerting (Email, Slack, Webhooks, Telegram, Discord)
- Enterprise RBAC and multi-tenancy

---

## Features

### Testing & Automation

- **Test Types**: Browser (Playwright), API, Database, and Custom script execution
- **Interactive Playground**: Built-in code editor for test development
- **Scheduled Jobs**: Cron-based test automation with parallel execution
- **AI-Powered Fixing**: Automated failure analysis and fix suggestions
- **Artifact Storage**: Reports, screenshots, and videos stored in MinIO

### Monitoring

- **5 Monitor Types**: Synthetic tests, HTTP/HTTPS, Website checks, Ping, Port monitoring
- **Multi-Location**: Execute checks from 3 geographic regions with configurable strategies
- **SSL Monitoring**: Certificate expiration tracking and validation
- **Response Time Metrics**: Historical performance data and trending

### Status Pages

- **Public Pages**: UUID-based subdomains for service status communication
- **Incident Management**: Create, update, and track incidents with workflow states
- **Subscriber Notifications**: Email and webhook notifications for status changes
- **Custom Branding**: Configurable colors, logos, and styling
- **Scheduled Maintenance**: Pre-announce maintenance windows

### Alerting & Notifications

- **Multi-Channel Support**: Email, Slack, Webhooks, Telegram, Discord
- **Smart Rules**: Configurable failure/recovery thresholds
- **Alert Types**: Monitor failures, SSL expiration, job failures, recoveries

### Access Control

- **Multi-Tenant**: Organizations and projects with isolated data
- **RBAC**: 6 permission levels from Super Admin to Project Viewer
- **API Keys**: Secure programmatic access
- **Audit Logging**: Complete activity tracking

---

## Architecture

```
┌─────────────────────────────────────────┐
│          Next.js App Service            │
│  Frontend, API Routes, Job Schedulers   │
└────────────────┬────────────────────────┘
                 │
     ┌───────────┼───────────┬──────────────┐
     ↓           ↓           ↓              ↓
┌──────────┐ ┌───────┐ ┌─────────┐  ┌──────────────────┐
│PostgreSQL│ │ Redis │ │  MinIO  │  │  Worker Cluster  │
│    DB    │ │ Queue │ │ Storage │  │                  │
└──────────┘ └───────┘ └─────────┘  │ ┌──────────────┐ │
                 ↓                   │ │  Worker #1   │ │
                 └───────────────────┼→│  (NestJS)    │ │
                                     │ └──────────────┘ │
                                     │ ┌──────────────┐ │
                                     │ │  Worker #2   │ │
                                     │ │  (NestJS)    │ │
                                     │ └──────────────┘ │
                                     │ ┌──────────────┐ │
                                     │ │  Worker #N   │ │
                                     │ │  (NestJS)    │ │
                                     │ └──────────────┘ │
                                     └──────────────────┘
```

**Technology Stack:**

- **Frontend**: Next.js 16+, React 19+, TypeScript, TailwindCSS
- **Backend**: NestJS for worker service
- **Database**: PostgreSQL 18+ with Drizzle ORM
- **Queue**: Redis + BullMQ for distributed job processing
- **Storage**: MinIO (S3-compatible) for artifacts
- **Testing**: Playwright for browser automation

---

## Quick Start

### Docker (Recommended)

```bash
# Clone repository
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck

# Configure environment
cp .env.example .env

# Start services
docker-compose up -d

# Create admin user
docker-compose exec app npm run setup:admin admin@example.com
```

Access at: `http://localhost:3000`

### Local Development

```bash
# Install dependencies
cd app && npm install
cd ../worker && npm install

# Configure environment
cp .env.example .env.local

# Start database
docker-compose up -d postgres redis minio

# Run migrations
cd app && npm run db:migrate

# Start services (separate terminals)
cd app && npm run dev
cd worker && npm run dev
```

---

## Documentation

- **[Contributing Guide](CONTRIBUTING.md)** - Development setup and guidelines
- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Community standards
- **[Support](SUPPORT.md)** - Getting help

---

## Development

### Prerequisites

- Node.js 20.0.0+
- Docker & Docker Compose
- PostgreSQL 18+
- Redis

### Available Commands

**App Service:**

```bash
cd app
npm run dev              # Development server
npm run build           # Production build
npm run lint            # Lint code
npm run db:generate     # Generate migrations
npm run db:migrate      # Run migrations
```

**Worker Service:**

```bash
cd worker
npm run dev             # Development server
npm run build           # Production build
npm run lint            # Lint code
npm run test            # Run tests
```

### Project Structure

```
supercheck/
├── app/                # Next.js frontend & API
│   ├── src/
│   │   ├── app/       # App Router pages
│   │   ├── components/# React components
│   │   ├── lib/       # Services and utilities
│   │   └── db/        # Database schema
├── worker/            # NestJS worker service
│   └── src/
│       └── modules/   # Worker modules
├── docs/              # Documentation site
└── docker-compose.yml # Docker configuration
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development environment setup
- Code style and conventions
- Pull request process
- Testing requirements

---

## License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Community & Support

- **Issues**: [GitHub Issues](https://github.com/supercheck-io/supercheck/issues)
- **Discussions**: [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)
- **Support**: See [SUPPORT.md](SUPPORT.md)

---

<div align="center">

Built with ❤️ for the open source community

[⬆ Back to top](#supercheck)

</div>

# Supercheck Technical Documentation

Welcome to the comprehensive technical documentation for **Supercheck**, an enterprise-grade end-to-end testing, monitoring, and AI-powered automation platform built with modern distributed architecture.

> 📖 **For getting started**: See the [main README](../README.md) for quick setup instructions and usage guide.

This documentation is organized into **logical folders** for easy navigation and maintenance. All specifications use **Mermaid diagrams exclusively** (no code snippets) and follow consistent naming conventions.

---

## 📂 Documentation Structure

### [01-core/](01-core/) - Core System Documentation

**Foundation:** System architecture, database design, and API structure

| File | Description |
|------|-------------|
| [supercheck-architecture.md](01-core/supercheck-architecture.md) | Complete system architecture with React 19, Next.js 15, AI services |
| [erd-diagram.md](01-core/erd-diagram.md) | Database schema with 60+ tables and entity relationships |
| [api-routes-analysis.md](01-core/api-routes-analysis.md) | Complete API structure with 60+ endpoints |

---

### [02-authentication/](02-authentication/) - Authentication & Security

**Security:** User authentication, authorization, and secrets management

| File | Description |
|------|-------------|
| [authentication-system.md](02-authentication/authentication-system.md) | Better Auth 1.2.8 integration and OAuth providers |
| [rbac-system.md](02-authentication/rbac-system.md) | Multi-level role-based access control (6 permission levels) |
| [api-key-system.md](02-authentication/api-key-system.md) | API key management with token bucket rate limiting |
| [project-variables-system.md](02-authentication/project-variables-system.md) | Variables & secrets with AES-128-GCM encryption |

---

### [03-execution/](03-execution/) - Testing & Execution

**Execution:** Test orchestration, queue management, and container execution

| File | Description |
|------|-------------|
| [execution-system.md](03-execution/execution-system.md) | **Complete execution architecture:**<br/>• BullMQ queue system (10 queues)<br/>• Container-based execution with Docker security<br/>• Multi-location execution (US, EU, APAC)<br/>• Scheduler system (jobs, monitors, K6)<br/>• Worker architecture and scaling<br/>• Resource management |
| [job-trigger-system.md](03-execution/job-trigger-system.md) | Manual, remote (API), and cron-scheduled job triggers |

---

### [04-monitoring/](04-monitoring/) - Monitoring & Alerting

**Monitoring:** Health checks, alerting, and notification delivery

| File | Description |
|------|-------------|
| [monitoring-system.md](04-monitoring/monitoring-system.md) | HTTP, HTTPS, Ping, Port monitoring with multi-location support |
| [notifications-system.md](04-monitoring/notifications-system.md) | Multi-channel alerts (Email, Slack, Webhooks, Telegram, Discord, RSS) |
| [alert-history-system.md](04-monitoring/alert-history-system.md) | Alert delivery tracking and failure diagnostics |

---

### [05-features/](05-features/) - Platform Features

**Features:** User-facing features and specialized functionality

| File | Description |
|------|-------------|
| [status-pages-system.md](05-features/status-pages-system.md) | **Public status communication:**<br/>• UUID-based subdomain routing<br/>• Incident management and timeline<br/>• Subscriber management (email, SMS, webhook)<br/>• Component organization and metrics |
| [ai-fix-system.md](05-features/ai-fix-system.md) | **AI-powered test fixing:**<br/>• OpenAI GPT-4o-mini integration<br/>• Error classification (11 categories)<br/>• Intelligent code generation<br/>• Monaco diff viewer |
| [tag-system.md](05-features/tag-system.md) | **Tag management:**<br/>• Project-scoped tags with color coding<br/>• Bulk operations and smart filtering<br/>• Usage analytics and RBAC integration |
| [playground-system.md](05-features/playground-system.md) | **Interactive sandbox:**<br/>• Monaco code editor<br/>• Template library and AI fixes<br/>• Multi-location execution<br/>• 24-hour artifact retention |

---

### [06-data/](06-data/) - Data & Storage

**Data:** Storage, lifecycle management, reporting, and audit logging

| File | Description |
|------|-------------|
| [storage-system.md](06-data/storage-system.md) | **S3/MinIO artifact management:**<br/>• Multi-bucket organization (5 buckets)<br/>• Upload/download flows<br/>• Presigned URL generation<br/>• Security and access control |
| [data-lifecycle-system.md](06-data/data-lifecycle-system.md) | **Cleanup and retention:**<br/>• Monitor results cleanup (30 days)<br/>• Job runs cleanup (90 days)<br/>• Playground cleanup (24 hours)<br/>• Automated scheduling and dry-run mode |
| [dashboard-and-reports.md](06-data/dashboard-and-reports.md) | **Dashboard & reporting:**<br/>• Monitor uptime and availability<br/>• Job execution statistics<br/>• Test execution counts<br/>• Report retrieval and caching |
| [audit-logging-system.md](06-data/audit-logging-system.md) | **Audit trail:**<br/>• User action tracking<br/>• System event logging<br/>• Security monitoring<br/>• Compliance-ready retention |

---

### [07-admin/](07-admin/) - Administration & System Management

**Admin:** Platform administration and system oversight

| File | Description |
|------|-------------|
| [super-admin-system.md](07-admin/super-admin-system.md) | **Platform management:**<br/>• System statistics dashboard<br/>• User and organization management<br/>• Scheduler and queue control<br/>• Impersonation for debugging |

---

### [08-operations/](08-operations/) - System Operations

**Operations:** Operational concerns, performance, and scaling

| File | Description |
|------|-------------|
| [organization-and-project-implementation.md](08-operations/organization-and-project-implementation.md) | Multi-tenant organization structure |
| [memory-management.md](08-operations/memory-management.md) | Production-ready memory management and optimization |
| [real-time-status-updates-sse.md](08-operations/real-time-status-updates-sse.md) | Server-Sent Events for live test status streaming |
| [scaling-guide.md](08-operations/scaling-guide.md) | Horizontal and vertical scaling strategies |
| [improvement-suggestions.md](08-operations/improvement-suggestions.md) | Scalability and robustness recommendations |

---

## 🎯 Quick Navigation by Role

### 🚀 For Platform Developers

**Getting Started:**
1. `01-core/supercheck-architecture.md` - System overview
2. `01-core/erd-diagram.md` - Database design
3. `03-execution/execution-system.md` - Execution pipeline
4. `06-data/storage-system.md` - Artifact management

**Feature Development:**
- Authentication → `02-authentication/`
- Testing & Execution → `03-execution/`
- Monitoring → `04-monitoring/`
- New Features → `05-features/`

---

### 🔧 For System Administrators

**Production Setup:**
1. `01-core/supercheck-architecture.md` - Infrastructure
2. `02-authentication/` - Security configuration
3. `04-monitoring/` - System health monitoring
4. `06-data/data-lifecycle-system.md` - Cleanup policies

**Operations:**
- Memory: `08-operations/memory-management.md`
- Scaling: `08-operations/scaling-guide.md`
- Monitoring: `08-operations/real-time-status-updates-sse.md`
- Improvements: `08-operations/improvement-suggestions.md`

---

### 📊 For Product Managers

**Feature Overview:**
- Core capabilities: `01-core/api-routes-analysis.md`
- User features: `05-features/`
- Monitoring & alerts: `04-monitoring/`
- Admin tools: `07-admin/`

**Analytics:**
- Dashboard: `06-data/dashboard-and-reports.md`
- Audit trail: `06-data/audit-logging-system.md`
- Tags: `05-features/tag-system.md`

---

## 📋 Documentation Standards

### File Naming Convention
**Pattern:** `{feature-name}-system.md` (lowercase with hyphens)

✅ `authentication-system.md` | ❌ `Authentication.md`

### Folder Organization
**Pattern:** `{number}-{category}/` (numbered for logical order)

Each specification includes:
1. Overview - What is this?
2. Architecture - Mermaid diagrams
3. Features - What does it do?
4. Flows - How does it work?
5. Configuration - How to set it up?
6. Best Practices - Recommendations
7. Summary - Quick checklist

---

## ✅ Complete Feature Coverage

### Core ✅
Architecture • Database • API Routes

### Security ✅
Auth • RBAC • API Keys • Variables

### Execution ✅
Queues • Containers • Multi-Location • Schedulers • Workers

### Monitoring ✅
Monitors • Notifications • Alert History

### Features ✅
Status Pages • AI Fix • Tags • Playground

### Data ✅
Storage • Lifecycle • Reports • Audit Logs

### Admin ✅
Super Admin • User Management • Organization Management

### Operations ✅
Memory • SSE • Scaling • Organizations

---

## 📞 Support

For documentation questions:
1. Navigate to the relevant folder
2. Review the specification file
3. Check cross-references to related specs

---

**Documentation Version:** 3.0 (Folder-Organized)
**Last Updated:** January 17, 2025
**Total Files:** 26 specifications across 8 folders
**Status:** Production Ready with 100% Feature Coverage

```
specs/
├── 01-core/ (3 files)
├── 02-authentication/ (4 files)
├── 03-execution/ (2 files)
├── 04-monitoring/ (3 files)
├── 05-features/ (4 files)
├── 06-data/ (4 files)
├── 07-admin/ (1 file)
└── 08-operations/ (5 files)
```

✅ **Logical grouping** by domain
✅ **Easy navigation** with numbered folders
✅ **Consistent naming** across all files
✅ **Complete coverage** of all features
✅ **Mermaid diagrams** exclusively
✅ **Professional structure** for maintenance

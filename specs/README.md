# Supercheck Technical Documentation

> Complete technical specifications, architecture guides, and implementation documentation for the SuperCheck platform.

## 📚 Folder Guide

Each folder below has a detailed **README.md** explaining the section and linking all relevant documents:

| Section                                    | Focus               | Key Files                                   |
| ------------------------------------------ | ------------------- | ------------------------------------------- |
| **[01-core](01-core)**                     | Core architecture   | Architecture, Database schema, API routes   |
| **[02-authentication](02-authentication)** | Auth & security     | Authentication, RBAC, API keys, Social auth |
| **[03-execution](03-execution)**           | Test execution      | Execution system, Job triggers              |
| **[04-monitoring](04-monitoring)**         | Monitoring & alerts | Monitoring, Notifications, Alerts           |
| **[05-features](05-features)**             | Platform features   | Status pages, AI fixes, Real-time updates   |
| **[06-data](06-data)**                     | Data management     | Storage, Lifecycle, Dashboards, Audit logs  |
| **[07-admin](07-admin)**                   | Administration      | Super admin system                          |
| **[08-operations](08-operations)**         | Operations          | Memory management, Performance optimization |
| **[09-deployment](09-deployment)**         | Deployment          | Setup, Configuration, Scaling               |
| **[10-testing](10-testing)**               | Testing & QA        | Test specifications, Coverage               |
| **[11-billing](11-billing)**               | Billing             | Monetization, Polar integration             |

---

## 01-core/ — Core System

- [SUPERCHECK_ARCHITECTURE.md](01-core/SUPERCHECK_ARCHITECTURE.md) - Platform architecture
- [ERD_DIAGRAM.md](01-core/ERD_DIAGRAM.md) - Database schema
- [API_ROUTES_ANALYSIS.md](01-core/API_ROUTES_ANALYSIS.md) - API routes

## 02-authentication/ — Authentication & Security

- [AUTHENTICATION_SYSTEM.md](02-authentication/AUTHENTICATION_SYSTEM.md) - Auth flows
- [RBAC_SYSTEM.md](02-authentication/RBAC_SYSTEM.md) - Role-based access
- [API_KEY_SYSTEM.md](02-authentication/API_KEY_SYSTEM.md) - API keys
- [PROJECT_VARIABLES_SYSTEM.md](02-authentication/PROJECT_VARIABLES_SYSTEM.md) - Project variables
- [SOCIAL_AUTH_SETUP.md](02-authentication/SOCIAL_AUTH_SETUP.md) - Social authentication setup

## 03-execution/ — Testing & Execution

- [EXECUTION_SYSTEM.md](03-execution/EXECUTION_SYSTEM.md) - Execution architecture
- [JOB_TRIGGER_SYSTEM.md](03-execution/JOB_TRIGGER_SYSTEM.md) - Job triggers

## 04-monitoring/ — Monitoring & Alerting

- [MONITORING_SYSTEM.md](04-monitoring/MONITORING_SYSTEM.md) - Monitoring system
- [NOTIFICATIONS_SYSTEM.md](04-monitoring/NOTIFICATIONS_SYSTEM.md) - Notifications
- [ALERT_HISTORY_SYSTEM.md](04-monitoring/ALERT_HISTORY_SYSTEM.md) - Alert history

## 05-features/ — Platform Features

- [STATUS_PAGES_SYSTEM.md](05-features/STATUS_PAGES_SYSTEM.md) - Status pages
- [AI_FIX_SYSTEM.md](05-features/AI_FIX_SYSTEM.md) - AI-assisted fixes
- [TAG_SYSTEM.md](05-features/TAG_SYSTEM.md) - Tagging
- [PLAYGROUND_SYSTEM.md](05-features/PLAYGROUND_SYSTEM.md) - Playground
- [REAL_TIME_STATUS_UPDATES_SSE.md](05-features/REAL_TIME_STATUS_UPDATES_SSE.md) - Real-time updates with SSE

## 06-data/ — Data & Storage

- [STORAGE_SYSTEM.md](06-data/STORAGE_SYSTEM.md) - Storage system
- [DATA_LIFECYCLE_SYSTEM.md](06-data/DATA_LIFECYCLE_SYSTEM.md) - Data lifecycle
- [DASHBOARD_AND_REPORTS.md](06-data/DASHBOARD_AND_REPORTS.md) - Dashboards
- [AUDIT_LOGGING_SYSTEM.md](06-data/AUDIT_LOGGING_SYSTEM.md) - Audit logging

## 07-admin/ — Administration

- [SUPER_ADMIN_SYSTEM.md](07-admin/SUPER_ADMIN_SYSTEM.md) - Admin system

## 08-operations/ — Operations & Optimization

- [ORGANIZATION_AND_PROJECT_IMPLEMENTATION.md](08-operations/ORGANIZATION_AND_PROJECT_IMPLEMENTATION.md) - Org structure
- [MEMORY_MANAGEMENT.md](08-operations/MEMORY_MANAGEMENT.md) - Memory management & optimization
- [RESILIENCE_PATTERNS.md](08-operations/RESILIENCE_PATTERNS.md) - Queue alerting, rate limiting, retry logic
- [CI_CD_TESTING.md](08-operations/CI_CD_TESTING.md) - CI/CD pipelines and GitHub Actions
- [ENVIRONMENT_VARIABLES.md](08-operations/ENVIRONMENT_VARIABLES.md) - Comprehensive environment variables reference

## 09-deployment/ — Deployment & Setup

- [DOCKER_COMPOSE_GUIDE.md](09-deployment/DOCKER_COMPOSE_GUIDE.md) - Docker Compose for self-hosted and local dev
- [KUBERNETES_GUIDE.md](09-deployment/KUBERNETES_GUIDE.md) - Kubernetes deployment for managed cloud
- [TERRAFORM_GUIDE.md](09-deployment/TERRAFORM_GUIDE.md) - Infrastructure provisioning on Hetzner
- [SCALING_GUIDE.md](09-deployment/SCALING_GUIDE.md) - Scaling strategies
- [VPS_SETUP_GUIDE.md](09-deployment/VPS_SETUP_GUIDE.md) - Production-ready VPS setup with security hardening
- [LOCAL.md](09-deployment/LOCAL.md) - Local development setup
- [NODE_SETUP.md](09-deployment/NODE_SETUP.md) - Kubernetes node labeling and configuration
- [DEPLOYMENT_GUIDE.md](09-deployment/DEPLOYMENT_GUIDE.md) - Legacy deployment guide

## 10-testing/ — Testing & Quality Assurance

- [PLAYWRIGHT_UI_TEST_SPECIFICATION.md](10-testing/PLAYWRIGHT_UI_TEST_SPECIFICATION.md) - E2E test specification
- [TEST_COVERAGE_SPECIFICATION.md](10-testing/TEST_COVERAGE_SPECIFICATION.md) - Test coverage

## 11-billing/ — Billing & Monetization

- [POLAR_BILLING_INTEGRATION.md](11-billing/POLAR_BILLING_INTEGRATION.md) - Polar billing integration

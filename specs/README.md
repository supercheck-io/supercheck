# Supercheck Technical Documentation

Welcome to the comprehensive technical documentation for **Supercheck**, an enterprise-grade end-to-end testing, monitoring, and AI-powered automation platform built with modern distributed architecture.

> 📖 **For getting started**: See the [main README](../README.md) for quick setup instructions and usage guide.

This documentation provides in-depth technical specifications, architectural details, and implementation guides for developers and system administrators working with the Supercheck platform.

---

## 📚 Documentation Index

### 🏗️ Core System Documentation

- **[Supercheck Architecture](SUPERCHECK_ARCHITECTURE.md)** - Complete system architecture with modern technology stack (React 19, Next.js 15, AI services)
- **[Database Schema (ERD)](ERD_DIAGRAM.md)** - Complete database schema and entity relationships

### 🔐 Authentication & Security

- **[Authentication System](AUTHENTICATION_SYSTEM.md)** - Better Auth 1.2.8 integration and user authentication flows
- **[Role-Based Access Control (RBAC)](RBAC_SYSTEM.md)** - Multi-level permissions and access control implementation
- **[API Key System](API_KEY_SYSTEM.md)** - Job-specific API keys with Bearer authentication and rate limiting
- **[Project Variables & Secrets](PROJECT_VARIABLES_SYSTEM.md)** - Variable and secret management with AES-128-GCM encryption

### ⚡ Testing & Execution

- **[Execution System](EXECUTION_SYSTEM.md)** - Complete execution architecture including:
  - BullMQ queue system and job processing
  - Container-based execution with Docker security
  - Multi-location execution for global coverage
  - Scheduler system (jobs, monitors, K6 tests)
  - Worker architecture and resource management
  - Docker Compose best practices and scaling strategies

### 👀 Monitoring & Alerting

- **[Monitoring System](MONITORING_SYSTEM.md)** - HTTP, HTTPS, Ping, Port, and Website monitoring with multi-location support
- **[Notifications System](NOTIFICATIONS_SYSTEM.md)** - Multi-channel alerting (Email, Slack, Webhooks, Telegram, Discord, RSS)

### 📢 Public Features

- **[Status Pages System](STATUS_PAGES_SYSTEM.md)** - Public-facing status communication with:
  - UUID-based subdomain routing
  - Incident management and timeline tracking
  - Subscriber management (email, SMS, webhook)
  - Component organization and status tracking
  - Metrics and uptime calculations

### 🤖 AI Features

- **[AI Fix System](AI_FIX_SYSTEM.md)** - AI-powered test fixing with:
  - OpenAI GPT-4o-mini integration
  - Error classification (11 categories)
  - Intelligent code generation
  - Monaco diff viewer integration

### 💾 Data & Storage

- **[Storage System](STORAGE_SYSTEM.md)** - S3/MinIO artifact management including:
  - Multi-bucket organization strategy
  - Upload/download flows for all artifact types
  - Presigned URL generation
  - Security and access control
  - Performance optimization

- **[Data Lifecycle System](DATA_LIFECYCLE_SYSTEM.md)** - Cleanup and retention management:
  - Monitor results cleanup (30 days)
  - Job runs cleanup (90 days)
  - Playground artifacts cleanup (24 hours)
  - Automated scheduling and dry-run mode

### 📋 Management & Organization

- **[Organization & Project Implementation](ORGANIZATION_AND_PROJECT_IMPLEMENTATION.md)** - Multi-tenant organization structure
- **[Job Trigger System](JOB_TRIGGER_SYSTEM.md)** - Manual, remote, and cron-scheduled job execution
- **[Parallel Execution & Capacity Management](PARALLEL_EXECUTION_CAPACITY_MANAGEMENT.md)** - Sophisticated capacity control with HTTP 429 responses

### 🔍 System Operations

- **[Memory Management](MEMORY_MANAGEMENT.md)** - Production-ready memory management and optimization
- **[Real-Time Status Updates (SSE)](REAL_TIME_STATUS_UPDATES_SSE.md)** - Server-Sent Events for live test status streaming
- **[Scaling Guide](SCALING_GUIDE.md)** - Horizontal and vertical scaling strategies

### 📈 Planning & Improvements

- **[Reorganization Plan](REORGANIZATION_PLAN.md)** - Documentation reorganization strategy and implementation plan

---

## 🎯 Quick Start Guides

### 🚀 For Platform Developers

1. **Architecture Understanding**: Start with **[Supercheck Architecture](SUPERCHECK_ARCHITECTURE.md)** for system overview
2. **Execution Pipeline**: Review **[Execution System](EXECUTION_SYSTEM.md)** for core execution concepts
3. **Storage & Data**: Understand **[Storage System](STORAGE_SYSTEM.md)** and **[Data Lifecycle System](DATA_LIFECYCLE_SYSTEM.md)**
4. **AI Integration**: Explore **[AI Fix System](AI_FIX_SYSTEM.md)** for AI-powered features

### 🔧 For System Administrators

1. **Production Setup**: Configure environment variables and deployment settings
2. **Security**: Set up **[Authentication System](AUTHENTICATION_SYSTEM.md)** and **[RBAC System](RBAC_SYSTEM.md)**
3. **Performance Tuning**: Optimize with **[Memory Management](MEMORY_MANAGEMENT.md)** and **[Scaling Guide](SCALING_GUIDE.md)**
4. **Monitoring**: Implement **[Monitoring System](MONITORING_SYSTEM.md)** and **[Status Pages System](STATUS_PAGES_SYSTEM.md)**

### 📊 For Monitoring Implementation

1. **Monitoring Architecture**: Read **[Monitoring System](MONITORING_SYSTEM.md)** for complete setup
2. **Alerting Configuration**: Configure **[Notifications System](NOTIFICATIONS_SYSTEM.md)** for multi-channel alerts
3. **Public Status Pages**: Deploy **[Status Pages System](STATUS_PAGES_SYSTEM.md)** for public communication
4. **Job Management**: Implement **[Job Trigger System](JOB_TRIGGER_SYSTEM.md)** for flexible execution

### 🐛 For Troubleshooting

1. **Authentication Issues**: Check **[API Key System](API_KEY_SYSTEM.md)** and **[Authentication System](AUTHENTICATION_SYSTEM.md)**
2. **Performance Problems**: Review **[Memory Management](MEMORY_MANAGEMENT.md)** and **[Execution System](EXECUTION_SYSTEM.md)**
3. **Storage Issues**: Diagnose with **[Storage System](STORAGE_SYSTEM.md)**
4. **Data Cleanup**: Manage with **[Data Lifecycle System](DATA_LIFECYCLE_SYSTEM.md)**

---

## 📋 Documentation Status

### ✅ Complete & Accurate (Updated January 2025)

- **System Architecture** - Complete with React 19.1.1, Next.js 15.4.6, and AI services
- **Execution System** - Comprehensive queue, container, and multi-location execution
- **Storage System** - Complete S3/MinIO architecture with security and optimization
- **Data Lifecycle** - Automated cleanup and retention management
- **Authentication & RBAC** - Better Auth 1.2.8 with multi-level permissions
- **Monitoring & Alerts** - Multi-location monitoring with multi-channel notifications
- **Status Pages** - Public status communication with incident management
- **AI Fix System** - OpenAI integration with intelligent test repair
- **API Key System** - Job-specific authentication with rate limiting
- **Database Schema** - Complete ERD with 60+ strategic indexes

### 🎯 Documentation Standards

All specifications follow these standards:
- ✅ **Mermaid Diagrams Only** - No code snippets, only visual diagrams
- ✅ **Consistent Naming** - All specs use `*_SYSTEM.md` convention
- ✅ **Feature-Based Organization** - Organized by domain, not technical layer
- ✅ **Comprehensive Coverage** - Architecture, flows, configuration, and best practices
- ✅ **Production Ready** - Based on actual implementation, not theoretical

---

## 🛠️ Contributing to Documentation

### Documentation Standards

1. **Use clear, descriptive titles** that indicate the content type
2. **Use Mermaid diagrams exclusively** - No code snippets
3. **Provide sequence diagrams** for flows and interactions
4. **Include architecture diagrams** for system components
5. **Add configuration references** with environment variables
6. **Provide troubleshooting sections** for common issues
7. **Update this index** when adding new documentation

### File Naming Convention

- `*_SYSTEM.md` - Feature/domain-specific documentation
- `*_DIAGRAM.md` - Diagram-only files (e.g., ERD)
- `README.md` - This index file
- `SUPERCHECK_ARCHITECTURE.md` - Core architecture overview

### Mermaid Diagram Guidelines

Use color coding for consistency:
- **Frontend**: `fill:#e3f2fd,stroke:#1976d2`
- **Backend**: `fill:#f3e5f5,stroke:#7b1fa2`
- **Data**: `fill:#e8f5e8,stroke:#388e3c`
- **Workers**: `fill:#fff3e0,stroke:#f57c00`
- **External**: `fill:#ffebee,stroke:#d32f2f`
- **Security**: `fill:#e0f2f1,stroke:#00796b`

---

## 🔗 Related Resources

- **Codebase**: Main application code in `/app` and `/worker` directories
- **Database Schema**: Located in `/app/src/db/schema/schema.ts`
- **API Routes**: Next.js API routes in `/app/src/app/api/`
- **Worker Services**: NestJS services in `/worker/src/`

---

## 📂 Repository Structure

```
/app/           - Next.js frontend application with API routes and database models
/worker/        - NestJS worker service for distributed test execution
/scripts/       - Deployment scripts, Docker builds, and utility tools
/specs/         - Technical documentation and system specifications (this directory)
/docs/          - Marketing site, public docs, and supporting assets
README.md       - Main project documentation with quick start guide
CONTRIBUTING.md - Contribution workflow, code style, and review expectations
```

---

## 📞 Support & Feedback

For documentation feedback or questions:
1. Check the relevant specification file for detailed information
2. Review the troubleshooting sections in each spec
3. Consult the [Reorganization Plan](REORGANIZATION_PLAN.md) for documentation structure

---

**Documentation Version:** 2.0
**Last Updated:** January 17, 2025
**Status:** Production Ready

This documentation reorganization follows best practices for technical documentation, ensuring:
- ✅ Clear feature-based navigation
- ✅ Consistent Mermaid diagram usage
- ✅ Comprehensive system coverage
- ✅ Easy maintenance and updates

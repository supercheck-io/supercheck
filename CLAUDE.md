# Claude AI Assistant Documentation

This document provides essential information for Claude AI assistants working on the SuperCheck codebase.

## 📋 Project Overview

SuperCheck is a comprehensive testing and monitoring platform that runs Playwright tests and provides monitoring capabilities with alerting, status pages, and AI-powered debugging.

## 🏗️ Architecture

- **Monorepo Structure**: App (Next.js frontend) + Worker (job execution)
- **Frontend**: Next.js 15.4.6, React 19.1.1, TypeScript, TailwindCSS
- **Backend**: Node.js, PostgreSQL, Redis, BullMQ
- **Testing**: Playwright execution in Docker containers
- **Storage**: MinIO/S3 compatible for reports and artifacts

## 📁 Key Directories

```
/app/                 # Next.js frontend application
  /src/
    /app/            # App router pages
    /components/     # React components
    /server/         # Server-side code (actions, services, db)
    /lib/            # Shared utilities
    /types/          # TypeScript type definitions

/worker/              # Job execution service
  /src/
    /execution/      # Test execution logic
    /k6/             # K6 load testing
    /monitoring/     # Monitoring services
    /common/         # Shared worker utilities

/specs/               # 📚 COMPREHENSIVE DOCUMENTATION
  /01-core/          # Architecture, API routes, ERD
  /02-authentication/ # Auth system, RBAC, API keys
  /03-execution/      # Test execution, job triggers
  /04-monitoring/     # Monitoring system, alerts
  /05-features/       # Status pages, AI fixes, playground
  /06-data/          # Storage, dashboards, data lifecycle
  /07-admin/         # Super admin system
  /08-operations/    # Scaling, memory management, billing

/deploy/              # Deployment configurations
  /docker/           # Docker compose files
  /k8s/              # Kubernetes manifests
```

## 🎯 Development Guidelines

### Before Making Changes
1. **Read the specs**: Always check `/specs/` for existing documentation
2. **Understand the architecture**: Review `01-core/` first
3. **Check authentication patterns**: See `02-authentication/`
4. **Verify execution patterns**: Review `03-execution/`

### Code Style
- Use TypeScript strictly (avoid `any`)
- Validate inputs with Zod schemas
- Use server actions for form submissions
- Keep components focused and small
- Follow existing patterns in the codebase

### Code Quality & Production Standards

**CRITICAL**: All code must meet production-grade standards. This is not a learning project—SuperCheck is a robust monitoring platform serving real users.

#### Best Coding Practices
- **Clean Code**: Write self-documenting code with clear intent
  - Use meaningful variable and function names
  - Keep functions small and focused (single responsibility)
  - Avoid nested complexity; extract to helper functions
  - Remove dead code, console logs, and debug statements
  - Use constants for magic numbers and strings
- **SOLID Principles**: Design code for maintainability
  - Single Responsibility: Each function/class does one thing
  - Open/Closed: Open for extension, closed for modification
  - Liskov Substitution: Proper inheritance hierarchies
  - Interface Segregation: Small, focused interfaces
  - Dependency Inversion: Depend on abstractions, not implementations
- **Error Handling**: Comprehensive and explicit
  - Never swallow errors silently
  - Use typed error handling (Result types or custom error classes)
  - Include context in error messages for debugging
  - Handle all possible failure paths explicitly
  - Log errors with sufficient context for troubleshooting

#### Security Concerns (Must Address)
- **Input Validation**: All user inputs must be validated
  - Use Zod schemas for API input validation
  - Sanitize user-provided data before storage
  - Validate file uploads (size, type, content)
  - Prevent SQL injection via Drizzle ORM parameterized queries
- **Authorization & Authentication**
  - Always verify permissions before operations
  - Use role-based access control (RBAC) properly
  - Never trust client-side authorization checks
  - Verify API key scopes match requested operations
  - Check organization/project membership for multi-tenant operations
- **Secrets Management**
  - Never commit secrets or API keys
  - Use environment variables for all sensitive data
  - Rotate secrets periodically
  - Audit access to sensitive operations
- **Data Protection**
  - Encrypt sensitive data at rest (e.g., API keys, credentials)
  - Use HTTPS only for all communication
  - Implement rate limiting on public endpoints
  - Validate and sanitize data before returning to clients
  - Never expose internal IDs or sensitive information in errors
- **Dependency Security**
  - Keep dependencies up to date
  - Regularly audit for vulnerabilities (npm audit)
  - Use minimal dependencies; avoid bloat
  - Review security advisories for critical packages

#### No Temporary Fixes
- **Never use temporary solutions** like:
  - Hardcoded values that should be configurable
  - Console.log() for debugging in production code
  - TODO/FIXME comments without issues tracking them
  - Commented-out code blocks (delete or use version control)
  - `any` types to bypass TypeScript checks
  - Catch-all exception handlers without handling
  - Disabled linting rules without documented reasons
- **If you take a shortcut**, create a GitHub issue immediately and link it in the code with proper context
- **Every change must be production-ready** on the first pass

#### Production-Grade Code Requirements
- **Scalability**: Design for growth
  - Use efficient algorithms (consider Big O)
  - Implement database indexing for frequently queried fields
  - Use pagination for large data sets
  - Implement caching where appropriate (Redis)
  - Use connection pooling for databases
  - Avoid N+1 query problems
- **Robustness**: Handle edge cases and failures
  - Implement proper retry logic with exponential backoff
  - Use circuit breakers for external API calls
  - Implement timeouts on all network operations
  - Handle partial failures gracefully
  - Implement idempotency for critical operations
- **Performance**: Optimize from the start
  - Profile before optimizing (don't guess)
  - Use appropriate data structures
  - Minimize database queries
  - Avoid blocking operations in hot paths
  - Monitor performance metrics
- **Observability**: Code must be debuggable
  - Use structured logging with appropriate levels
  - Include trace IDs for request tracking
  - Monitor critical business metrics
  - Set up alerts for error rates and anomalies
  - Include sufficient context in logs

#### Testing & Documentation
- **Unit Tests**: Write tests for critical logic
  - Test both happy path and edge cases
  - Use descriptive test names
  - Mock external dependencies
  - Aim for >80% coverage on critical paths
- **Integration Tests**: Verify component interactions
  - Test API endpoints with realistic data
  - Verify database transactions
  - Test authentication/authorization flows
  - Test error handling paths
- **Code Documentation**
  - Document complex algorithms and business logic
  - Add JSDoc comments for public APIs
  - Document assumptions and constraints
  - Keep documentation up to date with code changes
- **Specs Updates**: Always check if specifications need updating
  - If you modify API contracts, update `/specs/01-core/API_ROUTES_ANALYSIS.md`
  - If you change database schema, update `/specs/01-core/ERD_DIAGRAM.md`
  - If you modify authentication logic, update `/specs/02-authentication/`
  - If you modify execution logic, update `/specs/03-execution/`
  - Create migration guides if breaking changes are introduced

### Database
- Use Drizzle ORM for all database operations
- Check `/specs/01-core/ERD_DIAGRAM.md` for schema
- All queries in `/app/src/server/db/queries/`
- Migrations in `/app/src/server/db/migrations/`

### Authentication & Authorization
- Better Auth 1.2.8 for authentication
- RBAC implementation with roles
- API keys with scoped permissions
- See `/specs/02-authentication/` for details

## 🚀 Common Tasks

### Adding New Features
1. Check `/specs/05-features/` for similar patterns
2. Create database schema if needed
3. Add API routes in `/app/src/app/api/`
4. Create UI components in `/app/src/components/`
5. Add server actions in `/app/src/server/actions/`

### Working with Tests
- Test definitions stored in database
- Execution happens in Docker containers via worker
- Results stored in MinIO/S3
- See `/specs/03-execution/` for details

### Adding Monitoring
- Monitor types: HTTP, Ping, Port, Custom
- Configuration in database
- Execution via worker service
- See `/specs/04-monitoring/` for patterns

## 🔧 Environment Setup

### Required Environment Variables
```bash
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# Storage (MinIO/S3)
S3_ENDPOINT=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=...

# Authentication
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...

# AI (OpenAI)
OPENAI_API_KEY=...

# Email (Resend)
RESEND_API_KEY=...

# Polar Billing (optional)
POLAR_SERVER=production
POLAR_PLUS_PRODUCT_ID=...
POLAR_PRO_PRODUCT_ID=...

# Self-hosted mode
SELF_HOSTED=true
```

### Development Commands
```bash
# Frontend
npm run dev              # Start development server
npm run build            # Build for production
npm run lint             # Run ESLint

# Database
npm run db:generate      # Generate migration
npm run db:migrate       # Apply migrations
npm run db:studio        # Open Drizzle Studio

# Admin
npm run setup:admin      # Create admin user
npm run revoke:admin     # Remove admin privileges
```

## 📖 Essential Reading

### Must-Read Specs (in order)
1. `/specs/01-core/SUPERCHECK_ARCHITECTURE.md` - Overall architecture
2. `/specs/01-core/ERD_DIAGRAM.md` - Database schema
3. `/specs/01-core/API_ROUTES_ANALYSIS.md` - API endpoints
4. `/specs/02-authentication/AUTHENTICATION_SYSTEM.md` - Auth patterns
5. `/specs/03-execution/EXECUTION_SYSTEM.md` - Test execution
6. `/specs/04-monitoring/MONITORING_SYSTEM.md` - Monitoring

### Feature-Specific Specs
- Status Pages: `/specs/05-features/STATUS_PAGES_SYSTEM.md`
- AI Fixes: `/specs/05-features/AI_FIX_SYSTEM.md`
- Polar Billing: `/specs/08-operations/POLAR_BILLING_INTEGRATION.md`
- Memory Management: `/specs/08-operations/MEMORY_MANAGEMENT.md`

## 🐛 Debugging Tips

### Common Issues
- **Database**: Check `DATABASE_URL` and run migrations
- **Redis**: Verify `REDIS_URL` and connection
- **Storage**: Check S3/MinIO credentials and bucket access
- **Auth**: Verify Better Auth configuration
- **Worker**: Check Docker container access

### Logs & Monitoring
- Frontend logs in terminal during `npm run dev`
- Worker logs in worker container
- Database state via `npm run db:studio`
- Queue jobs via BullMQ dashboard

## 🎯 Quick Reference

### File Patterns
- API Routes: `/app/src/app/api/**/*.ts`
- Server Actions: `/app/src/server/actions/*.ts`
- Database Queries: `/app/src/server/db/queries/*.ts`
- UI Components: `/app/src/components/**/*.tsx`
- Worker Services: `/worker/src/**/*.ts`

### Key Services
- Test Execution: `/worker/src/execution/services/`
- K6 Execution: `/worker/src/k6/services/`
- Monitoring: `/worker/src/monitoring/services/`
- Report Upload: `/worker/src/common/services/report-upload.service.ts`

### Database Tables
Key tables (see ERD for complete schema):
- `organizations`, `projects`, `members` - Multi-tenancy
- `tests`, `test_runs`, `test_results` - Testing
- `monitors`, `monitor_runs`, `monitor_results` - Monitoring
- `alerts`, `notification_channels`, `alert_history` - Alerting
- `status_pages`, `incidents` - Status pages
- `api_keys`, `api_key_scopes` - Access control

## 📞 Getting Help

- **Issues**: https://github.com/supercheck-io/supercheck/issues
- **Discussions**: https://github.com/supercheck-io/supercheck/discussions
- **Documentation**: `/specs/` directory
- **Contributing**: `CONTRIBUTING.md` in root

---

**Last Updated**: 2025-12-01
**Version**: v1.1.9-beta.16
**Node Version**: 20.0.0+

## 📝 Notable Updates
- **2025-12-01**: Added comprehensive "Code Quality & Production Standards" section with requirements for best practices, security concerns, scalability, robustness, and specs documentation updates

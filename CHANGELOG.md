# Changelog

All notable changes to Supercheck are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)


## [1.2.2] - 2026-01-07

### Added
- Requirements management system with AI-powered extraction from documents
- Microsoft Teams notification integration via Power Automate webhooks
- Super admin CSV export for user management
- Multi-provider AI support: Azure OpenAI, Anthropic, Google Gemini, Vertex AI, AWS Bedrock, OpenRouter ([#157](https://github.com/supercheck-io/supercheck/issues/157))
- AI error helper for improved debugging experience
- Centralized AI provider configuration system

### Changed
- Enhanced webhook URL validation with allowlist for Teams
- Improved text sanitization for security

### Fixed
- CVE-2026-0621: ReDoS vulnerability in @modelcontextprotocol/sdk (GHSA-8r9q-7v3j-jr4g) by downgrading shadcn CLI to v2.5.0
- Configurable CNAME target for self-hosted custom domains ([#153](https://github.com/supercheck-io/supercheck/issues/153))
- Traefik updated to v3.6.6 for Docker 29+ API compatibility ([#152](https://github.com/supercheck-io/supercheck/issues/152))
- PostgreSQL data persistence documentation updated ([#162](https://github.com/supercheck-io/supercheck/issues/162))
- Fixed PDF/DOCX extraction, increased Server Actions limit to 12MB, updated CSP for self-hosting

---

## [1.2.1] - 2025-12-17

### Added
- Multi-region worker architecture with location-aware queue processing
- Live health check endpoint for workers
- Data table row hover prefetching for improved UX
- Service worker for static asset caching
- Monaco editor prefetching and loading spinners
- Client-side authentication guard with loading states
- Distributed locking and retry for job scheduler initialization
- Request-scoped session caching for performance
- Partial job updates via PATCH API
- Server-side data fetching for status pages

### Changed
- Consolidated data fetching with React Query hooks for improved caching
- Optimized dashboard API by aggregating execution times in SQL
- Reduced logging verbosity in production
- Improved loading messages and spinner sizing across the application
- Centralized Monaco editor theme definitions

### Fixed
- System health calculation accuracy
- Dashboard monitor count reliability
- Job status event cache eviction
- Hydration issues in social authentication
- Service worker update interval memory leaks
- Exclude 'error' status from failed run counts in analytics

### Performance
- Optimized data fetching with project context caching
- Increased stale times for better cache utilization
- Chunked script fetches to prevent timeouts
- Adjusted database connection timeouts

---

## [1.2.0] - 2025-11-16

### Added
- AI-powered test generation for Browser, API, and Performance tests
- AI-powered K6 performance test analysis with comparison UI
- K6 performance testing integration with xk6-dashboard extension
- K6 and Playwright analytics dashboards with run comparison
- Status pages for public-facing service health displays
- Custom domain support for status pages
- RSS and Slack subscription for status pages
- Real-time test execution with SSE progress tracking
- Multi-organization support with role-based access control (RBAC)
- Self-hosted deployment mode for enterprise
- Session invalidation and login lockout security features
- API key hashing for improved security
- Turnstile Captcha for cloud organization creation
- Email verification for cloud mode
- AI Fix feature for K6 tests with streaming support
- AI credit usage tracking and billing UI
- Queue health monitoring and alerting service
- Monitor statistics API with 24h and 30d aggregated metrics
- VU-minutes as K6 performance metric
- Ban user functionality for super admins
- Atomic job capacity enforcement using Redis Lua scripts

### Changed
- Redesigned dashboard with K6 performance statistics
- Migrated run duration to milliseconds for precision
- Standardized execution time display and K6 usage tracking to minutes
- Updated authentication system to Better Auth 1.4.5
- Enhanced RBAC permissions for run cancellation
- Improved capacity management with Redis-based optimizations
- Moved scheduler logic from worker to app
- Updated status page list UI

### Fixed
- App build issue with Next.js standalone build path in Dockerfile
- Multiple ESLint issues across the application
- SSE reconnection logic
- Self-hosted deployment documentation link path

### Security
- Hardened input sanitization and validation
- SSRF and ReDoS protection across components
- Tightened Slack and Discord webhook URL validation
- Container resource limit validation
- API rate limiting implementation
- Structured logging for audit trails

---

## [1.1.0] - 2025-09-22

### Added
- Initial monitoring system (HTTP, Ping, Port checks)
- Alert configuration with multiple notification providers
- Job scheduling with cron expressions
- Environment variable management for tests
- Docker Compose files for production deployment
- AI model configuration (GPT-4o-mini default)

### Changed
- Refactored environment variables for improved configurability
- Enhanced Docker Compose for production readiness

---

## [1.0.0] - 2025-08-29

### Added
- Initial release of Supercheck
- Playwright-based browser testing
- API testing capabilities
- Basic test execution engine
- Test reporting and results visualization
- Project and organization management
- User authentication and authorization

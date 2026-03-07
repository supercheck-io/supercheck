# Changelog

All notable changes to Supercheck are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)


## [1.3.2] - Unreleased

### Added
- **Registration controls for self-hosted deployments** — New `SIGNUP_ENABLED` environment variable to enable/disable new user registration, and `ALLOWED_EMAIL_DOMAINS` to restrict signup to specific email domains ([#246](https://github.com/supercheck-io/supercheck/issues/246))
- **Organization rename** — Organization owners and admins can now rename their organization from the Organization Admin page ([#247](https://github.com/supercheck-io/supercheck/issues/247))
- Added a UI callout on the self-hosted sign-up page to inform users about organization invitations
- **Status page support contact CTA** — Public status pages and incident notifications can now expose a `Get in touch` action backed by either an email address or a support URL ([#263](https://github.com/supercheck-io/supercheck/issues/263))

### Changed
- Streamlined admin interface by removing unused user creation functionality ([#245](https://github.com/supercheck-io/supercheck/issues/245))
- Clarified self-hosted scaling semantics across deployment docs and compose templates: `RUNNING_CAPACITY` and `QUEUED_CAPACITY` are App-side gating controls, while `WORKER_REPLICAS` remains the worker-side scaling knob
- Improved admin impersonation handling and session management flows
- Moved public status page branding suppression to a deployment-wide `STATUS_PAGE_HIDE_BRANDING` environment variable, removed the per-status-page settings toggle, and defaulted branding to visible unless the env var is set to `true`
- Updated public status page branding to use the Supercheck logo
- Reduced the monitor form name minimum from 10 to 3 characters to better support short operational labels ([#259](https://github.com/supercheck-io/supercheck/discussions/259))

### Fixed
- Fixed Playwright report loading performance. Implemented report caching across Playground, Runs, and Monitor views to prevent unnecessary re-fetching on tab switches
- Prevented caching of error responses from report proxy to avoid stale missing-report states after uploads complete
- Prevented setting a status page custom domain to `STATUS_PAGE_DOMAIN` or its subdomains, which would silently fail to route ([#253](https://github.com/supercheck-io/supercheck/issues/253))
- Fixed status page custom domains returning 404 in self-hosted deployments. Tightened proxy subdomain matching to only recognize UUID-format subdomains (32 hex chars), fixed domain-suffix boundary check that could misroute custom domains, improved `getEffectiveStatusPageDomain` fallback chain to derive from `APP_DOMAIN`/`APP_URL` when `STATUS_PAGE_DOMAIN` is not set, and added `APP_DOMAIN` as an accepted CNAME target for DNS verification ([#253](https://github.com/supercheck-io/supercheck/issues/253))
- Added catch-all Traefik routers to `docker-compose-secure.yml` and `docker-compose-external.yml` for custom domain support on status pages
- Fixed false "Queue capacity limit reached" errors during Redis Sentinel failover
- Improved self-hosted migration script performance and hardened database creation commands against SQL injection
- Fixed worker Redis documentation to use correct `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` variables instead of `REDIS_URL` for multi-location deployments ([#252](https://github.com/supercheck-io/supercheck/issues/252))
- Improved invitation onboarding flow and RBAC/session initialization: unauthenticated invitees now redirect to `/sign-up?invite=...` (with sign-in fallback for existing users), project selections are normalized and project-scope validated, `org_admin` invitations are restricted to org owners, expired pending invites are ignored in duplicate checks, and acceptance now initializes an active project context ([#254](https://github.com/supercheck-io/supercheck/issues/254))
- Hardened admin user deletion to handle dependent user-owned foreign key references inside a transaction ([#254](https://github.com/supercheck-io/supercheck/issues/254))
- Fixed status page support contact UX so `Get in touch` matches the `Subscribe` button styling, stays in the top action area on incident pages, and handles `mailto:` links consistently across public views and emails ([#263](https://github.com/supercheck-io/supercheck/issues/263))
- Fixed status page settings persistence so support contact, headline, and description can be cleared reliably and reflect immediately after save
- Added a failed linked monitors overview card on status pages so operators can see linked monitor failures without paging through the full monitor table ([#259](https://github.com/supercheck-io/supercheck/discussions/259))

### Security
- Fixed DoS vulnerability in underscore via unlimited recursion in `_.flatten` and `_.isEqual` (patched to 1.13.8)
- Fixed DoS vulnerabilities in multer via resource exhaustion and incomplete cleanup (patched to 2.1.0)
- Fixed RCE vulnerability in serialize-javascript via `RegExp.flags` and `Date.prototype.toISOString()` (patched to 7.0.3)
- Fixed stack overflow vulnerability in fast-xml-parser `XMLBuilder` with `preserveOrder` (patched to 5.3.8)
- Fixed ReDoS vulnerability in minimatch via combinatorial backtracking in `matchOne()` with non-adjacent GLOBSTAR segments (patched via dependency overrides)

## [1.3.1] - 2026-02-25

### Added
- **Multi-language support for status pages** — Localized UI strings in 20+ languages (Arabic, Chinese, Czech, Danish, Dutch, English, Finnish, French, German, Hindi, Croatian, Hungarian, Italian, Japanese, Korean, Norwegian, Polish, Portuguese, Romanian, Russian, Spanish, Swedish, Turkish, Ukrainian) ([#237](https://github.com/supercheck-io/supercheck/issues/237))
- **Status badges** — SVG badges for embedding current system status on external websites and READMEs
- **iCal calendar feed** — Subscribe to status page incidents in calendar applications (Google Calendar, Apple Calendar, Outlook)
- Email sign-up functionality for improved user onboarding ([#241](https://github.com/supercheck-io/supercheck/issues/241))

### Changed
- Enhanced public status page UI with improved incident details and subscription management
- Improved custom domain setup instructions with dynamic DNS record table, numbered steps, and Cloudflare proxy warning
- Improved mobile responsiveness across status page components and public views
- Basic auth support for sign-in page ([#241](https://github.com/supercheck-io/supercheck/issues/241))
- Streamlined sign-up process with improved invitation handling
- Improved SMTP configuration handling ([#238](https://github.com/supercheck-io/supercheck/issues/238))
- Enhanced VariableDialog to support secret value decryption and better state management
- Updated Docker images to use SUPERCHECK_VERSION for consistent version management
- Updated Playwright to version 1.58.2
- SMTP_USER and SMTP_PASSWORD environment variables are now optional to support email services that do not require authentication

### Security
- Fixed vulnerability in fast-xml-parser
- Added hex color validation for status badge SVG generation to prevent injection
- Fixed ReDoS vulnerability in minimatch (patched via dependency overrides)

### Fixed
- Fixed bug where custom domains could not be removed from status pages
---

## [1.3.0] - 2026-02-16

### Added
- **New CLI** — Command-line interface for Testing, Monitoring, and Reliability — as Code (`npm install -g @supercheck/cli`)
- **AI Analyze for Monitors** — Generate AI-powered health assessments and performance analysis for any monitor
- **AI Analyze for Job Runs** — Get AI-powered failure diagnosis and execution insights for Playwright and K6 runs
- TypeScript support for Playwright and K6 scripts
- API proxy helper used by the CLI and documentation

### Changed
- Improved invitation flows and member project assignment handling
- Org members API now returns both pending and expired invitations for explicit client-side state handling
- Updated CLI command flags and documentation
- Docs: static search index, refactored search dialog
- Refactored secret handling and execution logging for safer runtime behavior

### Security
- Fixed DoS vulnerability in fast-xml-parser (CVE)
- Added organization authorization checks for AI analysis endpoints
- Strengthened secret redaction flow in execution outputs before persistence/return

---

## [1.2.3] - 2026-01-22

### Added
- **Microsoft Edge browser extension** — Supercheck Recorder Extension for [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem)
- **Upside down monitor** — Monitor for services that should be DOWN ([#197](https://github.com/supercheck-io/supercheck/issues/197))
- **Custom headers for HTTP monitors** — Pass custom headers in HTTP monitor requests ([#196](https://github.com/supercheck-io/supercheck/issues/196))
- **Coolify deployment template** — Deployment configuration for Coolify ([#182](https://github.com/supercheck-io/supercheck/issues/182))
- Variable and secret resolution support for synthetic monitor scripts ([#201](https://github.com/supercheck-io/supercheck/issues/201))

### Changed
- Improved data freshness with optimized React Query refetch strategies
- Enhanced self-hosting documentation
- Standardized loading spinners and loading states across main routes
- Updated logo and community links in navigation

### Fixed
- Monitor creation wizard button labels and icon inconsistency ([#198](https://github.com/supercheck-io/supercheck/issues/198))
- New MS Teams webhook URLs not allowed for notifications ([#195](https://github.com/supercheck-io/supercheck/issues/195))
- Cache invalidation for requirements and cross-entity data consistency
- Audit Log Details page layout issues ([#164](https://github.com/supercheck-io/supercheck/issues/164))

---

## [1.2.2] - 2026-01-17

### Added
- **Supercheck Recorder extension** — Browser extension for Chromium based browsers to record user interactions and generate Playwright tests
- Extension auto-connect feature from Playground to Recorder with seamless handshake
- Requirements management system with AI-powered extraction from documents
- Microsoft Teams notification integration via Power Automate webhooks
- Super admin CSV export for user management
- Multi-provider AI support: Azure OpenAI, Anthropic, Google Gemini, Vertex AI, AWS Bedrock, OpenRouter ([#157](https://github.com/supercheck-io/supercheck/issues/157))
- AI error helper for improved debugging experience
- Centralized AI provider configuration system

### Changed
- Enhanced React Query caching strategy for faster page loads
- Updated new logo and added community links to the navigation header
- Enhanced webhook URL validation with allowlist for Teams
- Improved text sanitization for security

### Fixed
- Race condition in cache restoration during page navigation
- Unnecessary loading spinners when cached data is available
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

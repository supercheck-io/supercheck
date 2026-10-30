# Changelog

Notable changes to the Supercheck app and worker, including upgrade requirements for self-hosted installations. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The CLI is versioned separately; see [cli/CHANGELOG.md](cli/CHANGELOG.md). Prerelease builds (`-canary.N`) are not listed.

## [Unreleased]

### Upgrade notes

Read [Upgrade](https://supercheck.io/docs/app/deployment/self-hosted#upgrade) before upgrading a self-hosted installation.

- **Required secrets.** `docker-compose.yml` no longer falls back to built-in values for `DB_PASSWORD`, `REDIS_PASSWORD` and `BETTER_AUTH_SECRET` (and `docker-compose-external.yml` requires `BETTER_AUTH_SECRET`). Installer-created `.env` files already have them. If yours does not, Compose refuses to start and names the missing key: restore the `.env` you installed with, and never generate new values for an existing install.
- **Database TLS.** `sslmode` in `DATABASE_URL` is now honoured by the app, migrations and the worker. `require`, `verify-ca` and `verify-full` connect with a verified certificate, and `allow` and `prefer` try TLS first. An external PostgreSQL with a private certificate authority needs that CA trusted in the containers.
- **Image pins.** The bundled PostgreSQL and Redis images are pinned to `postgres:18.6` and `redis:8.10`, the versions the floating `18` and `8` tags pointed to.

### Added

- Supercheck Cloud sends server-side error reports from the app and worker to Sentry when `SENTRY_DSN` is set. A report has the error type, a shortened message scrubbed of secrets, URLs, email addresses, quoted text and database values, a stack trace, service (app or worker)/release/environment, OS and runtime versions, and internal IDs (hostnames and IPs in messages may appear); request contents, headers, cookies, form inputs, test scripts and run logs are not attached. Ignored when `SELF_HOSTED=true`, where the Sentry SDK is not loaded and no Sentry calls are made.
- The self-hosted installer measures free disk where Docker stores data, prompts whenever a terminal is available (including when output is piped), and in public mode warns about DNS that points elsewhere, a blocking `ufw` firewall, and HTTPS not answering after install.
- `PATCH /api/tests/{id}/tags` and `PATCH /api/monitors/{id}/tags` add and remove individual tags atomically (`{"add": [...], "remove": [...]}`), so concurrent tag changes are not lost. `POST` (replace) and `DELETE` (clear) are unchanged.
- The requirements API accepts `"priority": null` to clear a requirement's priority.
- `sudo bash install.sh --upgrade [--version X]` upgrades an existing installation in one step: it checks the checkout, dumps the database, keeps a copy of `.env`, checks out the release, refreshes the sandbox, imports the worker image and restarts with a health check, then removes the previous release's app and worker images (going back means restoring a backup taken on that release, which pulls its images again). `--version X` on an existing installation now points to `--upgrade` for a newer release and to `backup.sh --restore` for an older one.
- `deploy/docker/backup.sh` backs up the database, stored files, HTTPS certificates and `.env`, and `backup.sh --restore DIR` restores them onto the same release after confirmation.
- Opt-in `compose.dns01.yml` issues a wildcard certificate for status-page subdomains through a DNS-01 challenge.
- `DB_BIND_ADDR`, `REDIS_BIND_ADDR` and `RUSTFS_BIND_ADDR` in `.env` publish PostgreSQL, Redis and RustFS for remote workers without editing the Compose file.

### Fixed

- `PUT /api/jobs/{id}` accepts an `alertConfig` without `enabled`, `notificationProviders`, `alertOnFailure` or the thresholds, so a job pulled and deployed by the CLI can be updated. The job in the URL is always the one updated, even if the body carries another `jobId`.
- `PUT /api/jobs/{id}` keeps any `alertConfig` field the request omits at its stored value (for example `alertOnFailure: false`); create defaults apply only when no alert config is stored.
- `POST /api/cli/project-config/deploy` rejects more than 500 notification providers or SRE bindings per request.
- MCP `list_runs` returns the newest runs first (ordered by creation time, cursor format unchanged), and `get_monitor` reports the monitor's configured locations with `locationStrategy` and `locationThreshold`. `list_incidents` accepts `severity`, and `list_tests` accepts `type`, `priority` and `search`.
- `POST` and `PATCH` on `/api/tests/{id}/tags` and `/api/monitors/{id}/tags` return 400 instead of 500 when a tag is deleted between validation and insert.
- Monitor checks skipped because no worker is live in any expected location (such as during a deployment rollout) are no longer recorded as Down.
- A queued trial run is no longer failed when only another run's in-flight reservation puts it over the allowance; it stays queued until that run settles. An expired trial entitlement now counts as having no remaining allowance, as in the worker.
- MCP requests that stall while uploading their body now fail with 408 after 15 seconds and release their concurrency slots.
- Incident analytics charts, the sidebar's outline menu button and the response-time chart's tooltip cursor use valid colors (the `hsl()` wrappers around oklch tokens are removed).
- Trial allowance checks before queueing subtract runs that are still in flight, matching worker admission.
- A trial reminder whose delivery succeeded but whose sent-marker write failed transiently is no longer resent.
- A scheduled check for a deleted monitor removes its leftover repeatable schedule.

### Security

- Worker: `fast-uri` override raised to 3.1.9 (GHSA-w74x-v6f9-j3xg and related advisories in the build tooling chain); recorder dev dependencies refreshed. `npm audit` reports 0 vulnerabilities for app, worker, recorder, docs and cli.

### Changed

- The AI PR reviewer also sends the head-commit contents of changed files, within a character budget, as untrusted context. Lockfiles, build output and secret-like files are never sent.

## [1.4.0] - 2026-10-26

This release replaces the bundled MinIO storage with RustFS, adds a read-only MCP server, opens requirements and status pages to the API and CLI, makes automatic AI SRE triage opt-in, and hardens authentication, status pages and run cancellation. [CLI 0.4.0](cli/CHANGELOG.md) ships alongside it and needs this server version for its requirements, status page and monitor tag commands.

### Upgrade notes

Read these before upgrading a self-hosted installation.

- **Breaking: storage moves from MinIO to RustFS.** The bundled storage service is now RustFS (`rustfs`, volume `rustfs-data`), because MinIO no longer publishes container images. Run `deploy/docker/migrate-minio-to-rustfs.sh` before upgrading; see [Upgrading from MinIO](https://supercheck.io/docs/app/deployment/self-hosted#upgrading-from-minio-breaking). `docker-compose.yml` and `docker-compose-external.yml` no longer fall back to `minioadmin` and require `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (`docker-compose-local.yml` keeps its public, development-only defaults). The RustFS admin console is disabled and port 9001 is no longer published.
- **Breaking: Slack and Teams incident commands are removed.** Inbound commands, bot replies and the optional collaboration Compose overlay are gone; responders use the dashboard or the CLI. Remove `-f docker-compose-collaboration.yml` from your Compose commands. Ordinary Slack and Teams notifications and existing incident data are unchanged.
- **Breaking: automatic AI SRE triage is opt-in.** Alerts still appear as signals, and responders open incidents and run investigations manually. To keep automatic triage, set `SRE_AUTOMATION_ENABLED=true` in both the app and the worker. `SRE_ENABLED=false` turns AI SRE off entirely. These two settings replace the older per-workflow opt-out flags; remove those.
- **Database migrations.** Apply migrations `0024` to `0039` before updating the app and worker images. The app applies `0035` (an additive `invitation.created_at` column) itself at startup.
- **Remote workers** now require `REDIS_PASSWORD`.
- **Encryption key.** A placeholder `CHANGE_THIS`-style `SECRET_ENCRYPTION_KEY` is still accepted, so stored secrets stay readable, but the app and worker log a warning: anyone who knows the placeholder can decrypt stored variables and connector credentials. Set a real key (`openssl rand -hex 32`) and then re-enter those values, because they cannot be decrypted with the new key. New installs generate one with `./init-secrets.sh`. `.env.example` now documents this key instead of the unused `VARIABLES_ENCRYPTION_KEY` and `CREDENTIAL_ENCRYPTION_KEY`.
- **Playwright 1.64.0.** Hidden-iframe elements now count as hidden, `Locator.ariaRef()` is removed in favor of `ariaSnapshot()`, and `videosPath`/`videoSize` are replaced by `recordVideo`. Worker Firefox pins `screen` to 1280×720, so saved tests that override the viewport must also set a matching `screen` for screen-sensitive checks.
- **Log hygiene.** Before this release, a sign-in, sign-up or password form submitted before the page finished loading sent the email and password in the URL. If you run a reverse proxy or log shipper, consider purging old logs containing `/sign-in?email=` or `/reset-password?...password=`.
- **Keys created during impersonation.** CLI tokens, recorder keys and job trigger keys created while a super admin was impersonating a user before this release remain valid. Match `impersonation_start`/`impersonation_end` windows in the audit log against `cli_token_created`, `device_authorization_approved` and `api_key_created` events, then review CLI tokens, job API keys, recorder keys and Private Agents for that period and revoke anything you did not intend. Recorder-key creation has no audit event, only an application log.
- **Status page notifications** are delivered at least once; receivers should deduplicate by update ID. Webhook subscribers must now answer a single-use ownership challenge; existing subscriptions are grandfathered.

### Added

- **MCP server (off by default).** A remote, read-only MCP server at `/api/mcp` lets AI tools such as Claude, Cursor and VS Code read one project you choose: tests, jobs, runs, monitors, incidents, requirements, status pages, services, variable names and types (never values) and AI SRE investigations. Scripts and alert settings are excluded and credentials are redacted. `list_runs` filters by `status` and `jobId`, and `list_incidents` by `status`. Apps sign in with OAuth 2.1 and can be disconnected under **Connected apps**; access is re-checked on every call, so a disconnect, removal from the organization or a ban takes effect immediately (removal from only the project leaves read-only viewer access). Each connection is limited to 300 requests a minute, 4 at a time and 20 calls per batch. Set `MCP_SERVER_ENABLED=true` to turn it on (migration `0036`; `BETTER_AUTH_URL` must be the public HTTPS URL). `MCP_DYNAMIC_CLIENT_REGISTRATION=false` accepts only apps that identify themselves with a Client ID Metadata Document. See the [MCP docs](https://supercheck.io/docs/mcp).
- **Requirements, status page and tag API.** With a CLI token, requirements can be created, updated, deleted, linked to tests and exported as CSV (`/api/requirements`). Status pages can be created and updated, including publishing and archiving, with their components (`/api/status-pages`); the server always assigns the subdomain. Monitor tags can be read and assigned (`/api/monitors/{id}/tags`), and `GET /api/monitors` returns each monitor's tags. Test `priority` is validated (`low`, `medium`, `high`) and `GET /api/tests` filters by it. Dashboard actions and the API share one implementation, so the same checks apply to both.
- **Browser sign-in for the CLI.** `supercheck login` can approve a short code in the browser instead of copying a token. Off by default on self-hosted installs; set `DEVICE_AUTH_ENABLED=true` and run migration `0032_device_authorizations.sql`.
- **One-command self-hosted install.** `deploy/docker/install.sh` takes a fresh Ubuntu or Debian server to a verified install: preflight checks, prerequisites, secrets, the gVisor sandbox, image warm-up (so the first test run does not time out) and a health check, with `--local`, `--domain`, `--yes` and `--dry-run` for unattended use. It is safe to re-run and never regenerates secrets.
- **Status pages.** Scheduled maintenance (with monitor alert suppression), opt-in automatic outage and recovery incidents, webhook secret rotation, links from AI SRE incidents to public updates, recorded delivery attempts with retries and a retry action, and clearer custom-domain DNS guidance (migration `0030`).
- **Free trial (Supercheck Cloud).** New Cloud organizations start with a free trial. Self-hosted installs have no trial.
- **Playwright templates.** Four opt-in templates: diagnostics, passkeys, experimental Chromium WebMCP and job-scoped test locks.
- **AI providers.** DeepSeek V4.1 Flash is available as an optional provider.

### Changed

- **Status page health.** Component health follows linked monitors, and uptime is calculated from observed checks. Incident updates notify subscribers with the update's own content, scoped to their chosen components and incidents. System-generated incident and maintenance text uses the page language.
- **Copilot.** General and incident chat share one dedicated screen, and the AI SRE popup is removed; support chat remains available. A new chat keeps its incident context. Authorized live sources are on by default in the UI and both chat APIs; API callers can send `useLiveConnectorTools=false`. General-chat connector results stay temporary; incident results are saved.
- **AI SRE.** Manual AI SRE is enabled whenever an AI provider is configured. Investigations include stored evidence of every type, including evidence from connectors that are now disabled. Correlation and staged evidence no longer need separate deployment flags; live connector access still requires authorization and consent.
- **AI providers.** GPT-6 Luna is the default model.
- **Self-hosted Compose.** One main Compose file with optional `https` and `private-agent` profiles. HTTP evaluation binds to localhost; use HTTPS or SSH forwarding for remote access. Existing HTTPS commands keep working through a compatibility file, and remote and Cloud-connected Private Agents keep their standalone setup. `docker-compose-local.yml` publishes PostgreSQL, Redis and RustFS on `127.0.0.1`, so the app and worker can run from source against the same stack.
- **Execution.** Saved tests and the playground share the same validation of syntax, size, complexity and runner compatibility. Isolated Playwright runs support Node.js APIs, and k6 supports async and named-scenario scripts. Outcomes come from the Kubernetes exit status, and artifacts are still collected.
- **Playwright.** App, worker and E2E dependencies move to 1.64.0 (Chromium 156, Firefox 157, WebKit 27.2). The editor uses the installed Playwright version for typing, traces and videos are kept on failures and retries, and HTML reports are grouped.
- **AI test dialogs.** Clearer creation guidance, visible API and k6 examples, and improved code-review and analysis layouts. Generated scripts can still be reviewed and edited before they are applied.
- **API.** `GET /api/jobs` returns test scripts only with `?includeScript=true`. `GET /api/context` answers 403, not 401, for a valid token without access. Denials on test execution and job triggers include a machine-readable `code`.
- **Authentication.** Better Auth is upgraded to 1.7.12. Sign-in, sessions, API keys and organizations behave as before.
- **Worker setting.** New `CANCELLED_QUEUED_RECOVERY_ENABLED` (default `false`).

### Fixed

- **Run cancellation.** Cancelling a run that is waiting in the queue ends it right away instead of after about 80 minutes. A repeated cancel is harmless, a run that finishes just as it is cancelled keeps its real result, and workers end a cancelled run that they decline to start.
- **Monitors.** Editing alert channels or regions no longer restarts the check schedule. A database error while scheduling a check retries instead of marking the monitor down. A monitor whose report is stored under a previous storage endpoint can be deleted.
- **Queue reliability.** k6 submissions fail with `queue_unavailable` when no live matching worker exists. Monitor enqueue and publication failures mark the monitor down and advance its failure counters, and missing configured locations count toward All and majority aggregation. Aggregation counters are idempotent, so retries reuse saved final-failure evidence. Bull Board shows retained and disabled queues and the AI SRE triage queue.
- **Status page reliability.** A verified custom domain is never detached or unverified automatically; DNS failures are recorded by the daily check and recover when the records are fixed. Manually resolving an automatic incident stops it from being recreated until the component recovers. Scheduled incident updates require a valid maintenance window in both the dialog and the server action. The notification outbox drains in bounded batches instead of stopping at 100 deliveries per tick, does not re-queue the same rows under a large backlog, and prunes finished delivery rows after 30 days by default (`STATUS_PAGE_DELIVERY_RETENTION_DAYS`; migration `0031_status_page_reliability_hardening.sql`).
- **Status page components.** Changing a component's monitors through the API keeps the weights of monitors that stay linked, unless new `monitorWeights` are sent.
- **Requirements.** Uploading a document stops and reports the problem when a requirement cannot be created, instead of showing success.
- **Usage.** Unsettled Playwright and k6 usage is recovered after a worker restart without being counted twice (migration `0024_execution_usage_receipts.sql`). Database connection limits and k6 duration and virtual-user inputs are validated.
- **AI SRE.** A recurring alert opens a new incident once the previous one is resolved. Failed automatic triage is retried, and concurrent triage returns a conflict instead of an error.
- **Private Agents.** Job results cannot be overwritten by a replay; a matching replay is acknowledged without replacing the saved result. Connector output redaction processes up to 64K characters per text value, and stored excerpts keep their size cap. Expired connector credentials are never sent to agents and report that the connector must be re-authenticated.
- **Version reporting.** The app, worker, Private Agent and support chat report the deployed release, and execution jobs refresh mutable image tags so runs use the intended worker image.

### Security

- Resetting a password also revokes the account's CLI tokens, connected MCP apps and approved sign-in codes, and cancels other pending reset links; job trigger keys are kept. The reset email is sent in the background, so the response does not reveal whether an address has an account, and the reset page requests a fresh CAPTCHA each time.
- The sign-in, sign-up, forgot-password and reset-password forms declare `method="post"`, so an early submit can no longer put credentials in the URL.
- CLI tokens, recorder keys and job trigger keys cannot be created while a super admin is impersonating a user, and Better Auth's own `/api/auth/api-key/*` routes are no longer reachable. The 20-token limit and duplicate-name check are enforced atomically per project, and expired and disabled tokens no longer count toward the limit.
- Job trigger keys stop working while their owner is banned.
- Private Agents refuse plain-HTTP API URLs outside local and private networks (localhost, private and link-local IPs, and `.svc`, `.internal` and `.local` names).
- Slack subscriber URLs are masked in the dashboard.
- The recorder clears a stored key when the instance URL changes instead of reusing it against another host.
- Release validation, release API authentication and dependencies are hardened across the app, worker, docs and recorder.

### Removed

- Slack and Teams inbound incident commands and the collaboration Compose overlay (see the upgrade notes).
- Settings that nothing read, from the Compose files, `.env.example` files and `init-secrets.sh`: `REDIS_URL` (the app and worker use `REDIS_HOST`, `REDIS_PORT` and `REDIS_PASSWORD`), `S3_FORCE_PATH_STYLE` (path-style addressing is always on), `AZURE_API_VERSION` (the Azure provider always uses API version `v1`), `MAX_PROJECTS_PER_ORG`, `MONITOR_PRESERVE_STATUS_CHANGES`, `PLAYWRIGHT_HEADLESS` and `K6_MAX_CONCURRENCY`. Values left in an existing `.env` are ignored.

### Recorder

- Connects without setup on every first-party deployment (`app.supercheck.io`, `supercheck.io`, `demo.supercheck.dev`); self-hosted instances keep the explicit URL-setup flow. The options page separates automatic connections from advanced API-key use, reports rate limits, unreachable instances and rejected keys distinctly, and updates live after auto-connect. The Record dialog explains the self-hosted setup with a copyable origin, and an orphaned extension asks for a page refresh instead of showing the install dialog. The recorder docs cover the trust boundary, release flow and troubleshooting.



## [1.3.6] - 2026-09-15

- **AI SRE:** Add incident management, service topology, investigations, Copilot, diagnostic recipes, and Private Agents.
- **API and CLI:** Add incident operations, service topology, Copilot chat, and evidence-brief streaming. Consolidate the CLI and Recorder with the main open-source project.
- **Integrations:** Expand support for Datadog, Sentry, Elasticsearch/OpenSearch, GitLab, PagerDuty, and Opsgenie.
- **Reliability:** Improve Kubernetes test execution and failure reporting, and fix usage synchronization for investigations, connectors, and reports.
- **Security:** Strengthen tenant isolation, permissions, outbound request safety, execution safeguards, and self-hosted secret generation.
- Remove the unsupported Coolify template. Self-hosting remains available through Docker Compose with K3s and gVisor.



## [1.3.5] - 2026-06-17

- **Alert integrations:** Configure custom JSON payloads and HTTP methods for PagerDuty and Opsgenie webhooks.
- **Alert lifecycle:** Add PagerDuty lifecycle actions and deduplication keys to reduce repeated alerts and support automatic resolution.
- **Spending controls:** Add spending limits, notifications, and usage synchronization.
- **Execution visibility:** Show blocked job status and clearer quota and payment errors.
- Fix webhook payload escaping and method handling, and update security dependencies.

## [1.3.4] - 2026-04-13

- **Browser integrations:** Configure self-hosted API access with `CORS_ALLOWED_ORIGINS`, including wildcard subdomains for integrations such as Azure DevOps widgets.
- **Reusable test data:** Store CSV, JSON, YAML, XML, TSV, and plain-text fixtures as file variables for Playwright and k6 tests.
- **Authentication:** Update authentication and API-key support, with the accompanying database migration.
- **Status page domains:** Fix View/Copy links and custom-domain routing, and clarify DNS and TLS setup for self-hosted deployments.
- Fix overflowing organization invitation dialogs and update security dependencies.

**Upgrade note:** Apply the included database migration before starting the upgraded app.

## [1.3.3] - 2026-03-22

- **Sandboxed execution:** Run user-submitted scripts in isolated gVisor execution pods with restricted permissions and network access.
- **Execution locations:** Super Admins can add, edit, and enable or disable locations. Workers discover regional queues dynamically, and projects can restrict available locations.
- **Worker reliability:** Improve queue discovery, heartbeat handling, stale-queue cleanup, and behavior when Redis is unavailable.
- **Email alerts:** Fix delivery to multiple comma-separated recipients and accurately report partial delivery failures.
- Strengthen worker container isolation and patch framework and parser vulnerabilities.

**Upgrade note (self-hosted):** Test execution now uses K3s and gVisor instead of the Docker socket. Run `setup-k3s.sh` on a supported Linux host before upgrading. Workers use a Kubernetes kubeconfig; existing tests and monitors do not need changes. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted).

## [1.3.2] - 2026-03-12

- **Registration controls:** Use `SIGNUP_ENABLED` to control self-hosted signup and `ALLOWED_EMAIL_DOMAINS` to restrict accepted email domains.
- **Organization administration:** Owners and admins can rename organizations. Improve invitations, expired-invite handling, project selection after acceptance, and admin session management.
- **Status page support:** Add email or URL-based `Get in touch` actions to public pages and incident notifications, and fix clearing of support details, headlines, and descriptions.
- **Status page controls:** Remove the per-page branding toggle. Branding is visible by default; use `STATUS_PAGE_HIDE_BRANDING=true` to hide it across the deployment. Add an overview of failed linked monitors.
- **Monitoring:** Allow shorter monitor names and clarify app-side execution capacity versus worker scaling settings.
- **Reports and queues:** Improve Playwright report caching, avoid stale missing-report errors after upload, and fix false capacity errors during Redis failover.
- Harden migration and user-deletion handling, correct regional Redis configuration guidance, and patch dependency vulnerabilities.

## [1.3.1] - 2026-02-25

- **Public status pages:** Add localization in more than 20 languages, embeddable SVG status badges, and incident calendar feeds for Google Calendar, Apple Calendar, and Outlook.
- Improve incident details, subscription management, and mobile status page layouts.
- Improve email signup and invitations, add basic-auth support for the sign-in page, and support SMTP services that do not require credentials.
- Clarify custom-domain DNS setup and Cloudflare proxy requirements, and fix custom-domain removal.
- Update Playwright and patch XML parsing, badge generation, and pattern-matching vulnerabilities.

## [1.3.0] - 2026-02-16

- **Supercheck CLI:** Introduce testing, monitoring, and reliability as code through `@supercheck/cli`.
- **AI analysis:** Add monitor health assessments and Playwright/k6 job-run failure diagnosis and execution insights.
- Add TypeScript support for Playwright and k6 scripts.
- Improve invitations and project assignments, including visibility of pending and expired invitations.
- Improve documentation search and command guidance, strengthen AI endpoint permissions, and redact secrets from execution output.

## [1.2.3] - 2026-01-22

- **Edge Recorder:** Add the Supercheck Recorder extension for Microsoft Edge.
- **Monitoring:** Add checks for services that should be down and custom headers for HTTP monitors.
- Support variables and secrets in synthetic monitor scripts.
- Add the Coolify deployment template, later removed in 1.3.6.
- Improve cached-data freshness and fix requirement updates, audit-log layouts, monitor creation controls, and Microsoft Teams webhook validation.

## [1.2.2] - 2026-01-17

- **Supercheck Recorder:** Record browser interactions as Playwright tests and connect the extension directly from Playground.
- **Requirements:** Add AI-powered extraction from uploaded documents and fix PDF/DOCX extraction and upload-size handling.
- **Notifications:** Add Microsoft Teams integration through Power Automate webhooks.
- **AI providers:** Add Azure OpenAI, Anthropic, Google Gemini, Vertex AI, AWS Bedrock, and OpenRouter support, plus an AI error helper.
- Add Super Admin CSV user export and configurable CNAME targets for self-hosted status page domains.
- Fix cached-navigation loading behavior, improve webhook validation and self-hosting compatibility, and update security dependencies.

## [1.2.1] - 2025-12-17

- **Regional execution:** Add location-aware workers and live worker health checks.
- **Faster navigation:** Improve dashboard, editor, and status page loading through caching, prefetching, and more efficient data fetching.
- Improve scheduler initialization and retry handling, and support partial job updates.
- Improve execution-time reporting and monitor and system-health counts; exclude execution errors from failed-run analytics.
- Fix authentication hydration, background-update memory leaks, and job-status cache handling.

## [1.2.0] - 2025-11-16

- **AI testing:** Generate Browser, API, and Performance tests; stream k6 fixes; and analyze k6 runs with comparisons.
- **Performance testing:** Add k6 execution, dashboards, run comparisons, and virtual-user minute usage metrics.
- **Public status pages:** Add custom domains, incident subscriptions through RSS and Slack, and public service-health displays.
- **Teams and self-hosting:** Add self-hosted deployment mode, organization permissions, and role-based run cancellation.
- **Account security:** Add session invalidation, login lockouts, email verification, API-key hashing, and CAPTCHA protection for cloud organization creation.
- **Live execution:** Add streamed progress, queue health monitoring, atomic capacity enforcement, and clearer execution-time and usage reporting.
- **Usage and monitoring:** Add AI credit tracking, billing UI, and 24-hour and 30-day monitor statistics.
- Improve stream reconnection and container builds, and strengthen request validation, outbound request protection, rate limits, and audit logging.

## [1.1.0] - 2025-09-22

- Add HTTP, host reachability, and port monitoring with configurable notification providers.
- Add scheduled jobs, test variables, and Docker Compose production deployment.
- Add configurable AI models and improve deployment configuration.

## [1.0.0] - 2025-08-29

- Initial release with Playwright browser testing and API testing.
- Add test execution, reports, and results visualization.
- Add project and team management, authentication, and authorization.

[Unreleased]: https://github.com/supercheck-io/supercheck/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/supercheck-io/supercheck/compare/v1.3.6...v1.4.0
[1.3.6]: https://github.com/supercheck-io/supercheck/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/supercheck-io/supercheck/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/supercheck-io/supercheck/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/supercheck-io/supercheck/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/supercheck-io/supercheck/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/supercheck-io/supercheck/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/supercheck-io/supercheck/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/supercheck-io/supercheck/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/supercheck-io/supercheck/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/supercheck-io/supercheck/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/supercheck-io/supercheck/releases/tag/v1.2.0

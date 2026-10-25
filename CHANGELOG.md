# Changelog

Notable features, fixes, and upgrade requirements for Supercheck users. App and CLI releases are versioned separately.

## [Unreleased]
- **Runs:** Cancelling a run that is waiting in the queue now ends it right away instead of after about 80 minutes, a repeated cancel is harmless, and a run that finishes just as it is cancelled keeps its real result. Workers end a cancelled run that they decline to start. New worker setting `CANCELLED_QUEUED_RECOVERY_ENABLED` (default `false`). **Upgrade:** deploy workers first, then the app.
- **Security:** Resetting a password now also revokes the account's CLI tokens, connected MCP apps and approved sign-in codes, and cancels other pending reset links. Job trigger keys are kept. The reset email is sent in the background so the response does not reveal whether an address has an account, and the reset page requests a fresh CAPTCHA each time (an expired one used to show "too many attempts"). Job trigger keys stop working while their owner is banned.
- **MCP:** Each connection is limited to 300 requests a minute, 4 at a time, and 20 calls per batch.
- **MCP:** New read-only tools: `get_job`, `get_monitor`, `list_requirements`, `get_requirement`, `list_status_pages`, `get_status_page`, `list_services`, `get_service`, `list_variables` (names and types, never values), `list_investigations` and `get_investigation` (AI SRE findings and recommendations). `list_runs` filters by `status` and `jobId`, and `list_incidents` by `status`. The server stays read-only: starting AI SRE work remains in the dashboard and CLI. The consent screen lists the new resources.
- **API:** Requirements can be created, updated, deleted, linked to tests and exported as CSV with a CLI token (`/api/requirements`). Status pages can be created and updated, including publishing and archiving, and their components managed (`/api/status-pages`); the subdomain is always assigned by the server. Monitor tags can be read and assigned (`/api/monitors/{id}/tags`), and `GET /api/monitors` returns each monitor's tags. Test `priority` is validated (`low`, `medium`, `high`) and `GET /api/tests` filters by it. Dashboard actions and the API share one implementation, so the same checks apply to both.
- **API:** `GET /api/jobs` returns test scripts only with `?includeScript=true`. `GET /api/context` answers 403 (not 401) for a valid token without access.
- **CLI:** `doctor` reports a config that points at another API instead of reporting the token as rejected.
- **Monitors:** Editing alert channels or regions no longer restarts the check schedule. A database error while scheduling a check retries instead of marking the monitor down. A monitor with a report stored under a previous storage endpoint can be deleted.
- **Requirements:** Uploading a document stops and reports the problem when a requirement cannot be created, instead of showing success.
- **Free trial (cloud):** New Supercheck Cloud organizations will start with a free trial of the whole product, with allowances for monitors, status pages, team size, AI and execution. What it includes is on the pricing page. Browsing your data stays possible after it ends, and subscribing brings paused monitors and archived status pages back. Self-hosted installs have no trial. **Upgrade:** run database migrations `0037`, `0038` and `0039`, then deploy the app, then the workers.
- **Authentication:** Upgrade Better Auth to 1.7.12. Migration `0035` adds an `invitation.created_at` column (additive, with a default); the app applies it at startup, before it serves requests, so no manual step is needed. Sign-in, sessions, API keys and organizations behave as before.
- **MCP (off by default):** Remote, read-only MCP server at `/api/mcp` so AI tools such as Claude, Cursor and VS Code can read one project you choose: tests, jobs, runs, monitors and incidents (10 tools; no scripts, variable values or alert settings; credentials redacted). Apps sign in with OAuth 2.1 and you can disconnect any of them under **Connected apps**; access is re-checked on every call, so a disconnect, removal from the organization or a ban takes effect immediately (removal from only the project leaves read-only viewer access). Set `MCP_SERVER_ENABLED=true` to turn it on (migration `0036`; `BETTER_AUTH_URL` must be the public HTTPS URL). `MCP_DYNAMIC_CLIENT_REGISTRATION=false` accepts only apps that identify themselves with a Client ID Metadata Document. New [MCP docs](https://supercheck.io/docs/mcp).
- **CLI:** Sign in through the browser with `supercheck login`: approve a short code and choose the project, with no token to copy. It also works for coding agents (`login --json` returns the URL and code immediately and resumes on the next call) and headless machines (`--no-browser`). If the chosen organization has no active plan, the approval page offers a plan step that opens billing in a new tab for that organization. Off by default on self-hosted installs; set `DEVICE_AUTH_ENABLED=true` to enable it. Token login and `SUPERCHECK_TOKEN` are unchanged. **Upgrade:** run database migration `0032_device_authorizations.sql`.
- **CLI:** New commands for guided setup: `onboard` (read-only status and next step), `discover` (repository facts without running anything), `link` (point the config at your project), `plan` (subscription state), `ci init --github` (workflow template; you still add the token secret), and `agent install --target claude|cursor|codex|opencode|generic`. `deploy --verify` runs each created or updated browser test once in the cloud and waits for the result. Versioned guides for agents are built into the CLI (`supercheck skills onboarding`, `authoring`, `ci`, `safety`). JSON errors now include a stable `code`, `retryable` and suggested `nextActions`.
- **CLI (behavior change):** `SUPERCHECK_TOKEN`, `SUPERCHECK_URL` and `SUPERCHECK_TRIGGER_KEY` and proxy and TLS settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED`, ...) are no longer read from a project's `.env` file, so a cloned repository can no longer choose the credential the CLI uses, the server or proxy it is sent through, or weaken TLS. In human-readable mode the CLI warns when a `.env` sets them. **Upgrade:** export them in your shell, set them in your CI secret store, or run `supercheck login`; a config that reads `process.env.SUPERCHECK_URL` needs it exported rather than kept in `.env`.
- **CLI:** `doctor` now reads `supercheck.config.ts` as text instead of executing it, so it is safe to run in a repository you do not trust. `logout` now says that the key is removed from the machine only and must be revoked under CLI Tokens to invalidate it.
- **Security:** The sign-in, sign-up, forgot-password and reset-password forms now declare `method="post"`. Previously a submit before the page finished loading used GET and put the email and password in the URL (browser history and proxy/server logs). **Upgrade:** if you run a reverse proxy or log shipper, consider purging old logs containing `/sign-in?email=` or `/reset-password?...password=`.
- **API:** CLI tokens, recorder keys and job trigger keys can no longer be created while a super admin is impersonating a user, and Better Auth's own `/api/auth/api-key/*` routes are no longer reachable (API keys are created only through the application's token endpoints). **Upgrade:** keys created while a super admin was impersonating a user before this release remain valid. Match `impersonation_start`/`impersonation_end` windows in the audit log against `cli_token_created`, `device_authorization_approved` and `api_key_created` events, then review CLI Tokens, job API keys, recorder keys and Private Agents for that period and revoke anything you did not intend (recorder-key creation has no audit event, only an application log). The CLI-token limit and duplicate-name check are now enforced atomically per project, so concurrent requests can no longer exceed 20 tokens. Expired and disabled tokens no longer count toward the limit. Subscription denials on test execution and job triggers include a machine-readable `code`.
- **Recorder:** Connect without setup on every first-party deployment (`app.supercheck.io`, `supercheck.io`, `demo.supercheck.dev`), and keep self-hosted instances on the explicit URL-setup flow. The options page now separates automatic connections from advanced API-key use, clears a stored key when the instance URL changes instead of reusing it against another host, reports rate limits, unreachable instances, and rejected keys distinctly, and updates live after auto-connect. The Record dialog explains the self-hosted setup path with a copyable origin, and an orphaned extension prompts for a page refresh instead of showing the install dialog. Documented the trust boundary, release flow, and troubleshooting in the recorder docs.
- **Status pages:** Component health now follows linked monitors, and uptime is calculated from observed checks. Incident updates notify subscribers with the update's own content, scoped to their chosen components and incidents. Delivery attempts are recorded with retries and a retry action. Added scheduled maintenance (with monitor alert suppression), opt-in automatic outage/recovery incidents, webhook secret rotation, links from SRE incidents to public updates, and clearer custom-domain DNS guidance. Slack subscriber URLs are now masked in the dashboard. **Upgrade:** run database migration 0030. Notifications are at-least-once, so receivers should deduplicate by update ID.
- **Status page reliability:** A verified custom domain is never detached or unverified automatically; DNS failures are recorded by the daily check and recover when the records are fixed. Manually resolving an automatic incident suppresses recreation until the component recovers. Scheduled incident updates require a valid maintenance window in both the dialog and the server action. The notification outbox drains in bounded batches instead of stopping at 100 deliveries per tick, leases rows handed to a worker so a large backlog advances instead of re-queueing the same first rows, and prunes terminal delivery rows after 30 days by default (`STATUS_PAGE_DELIVERY_RETENTION_DAYS`). Webhook subscribers must answer a single-use ownership challenge before receiving notifications; existing subscriptions are grandfathered. System-generated incident and maintenance text now uses the page language. **Upgrade:** run database migration `0031_status_page_reliability_hardening.sql`.
- **Execution:** Align saved-test and playground validation on syntax, size, complexity, and runner compatibility. Support Node.js APIs in isolated Playwright runs and async/named-scenario k6 scripts. Determine execution outcomes from Kubernetes exit status and preserve artifact collection.
- **Playwright:** Use the installed Playwright version for editor typing, retain traces and videos on failures and retries, and group HTML reports. Add four opt-in templates for diagnostics, passkeys, experimental Chromium WebMCP, and job-scoped test locks.
- **Playwright:** Upgrade app, worker, and E2E dependencies to 1.64.0 (Chromium 156, Firefox 157, WebKit 27.2). Hidden-iframe elements now count as hidden; `Locator.ariaRef()` is removed in favor of `ariaSnapshot()`, and `videosPath`/`videoSize` are replaced by `recordVideo`. Worker Firefox pins `screen` to 1280×720; saved tests that override the viewport must also set a matching `screen` for screen-sensitive checks.
- **Self-hosting:** Removed settings that nothing read from the Compose files, `.env.example` files and `init-secrets.sh`: `REDIS_URL` (the app and worker use `REDIS_HOST`, `REDIS_PORT` and `REDIS_PASSWORD`), `S3_FORCE_PATH_STYLE` (path-style addressing is always on), `AZURE_API_VERSION` (the Azure provider always uses API version `v1`), `MAX_PROJECTS_PER_ORG`, `MONITOR_PRESERVE_STATUS_CHANGES`, `PLAYWRIGHT_HEADLESS` and `K6_MAX_CONCURRENCY`. Behavior is unchanged; values left in an existing `.env` are ignored.
- **Local development:** `docker-compose-local.yml` publishes PostgreSQL, Redis, and RustFS on `127.0.0.1`, so the app and worker can be stopped as containers and run from source (`npm run dev`) against the same stack and data.

- **Self-hosting:** New `deploy/docker/install.sh` takes a fresh Ubuntu/Debian server to a verified install in one command: preflight checks, prerequisites, secrets, the gVisor sandbox, image warm-up (so the first test run does not time out) and a health check, with `--local`, `--domain`, `--yes` and `--dry-run` for unattended use. It is safe to re-run and never regenerates secrets.
- **Self-hosting (breaking):** The bundled storage service is now RustFS (`rustfs`, volume `rustfs-data`) because MinIO no longer publishes container images. Existing installs must run `deploy/docker/migrate-minio-to-rustfs.sh` before upgrading; see [Upgrading from MinIO](https://supercheck.io/docs/app/deployment/self-hosted#upgrading-from-minio-breaking). `docker-compose.yml` and `docker-compose-external.yml` no longer fall back to `minioadmin` and require `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (the source-build `docker-compose-local.yml` keeps public dev-only defaults). The RustFS admin console is disabled and port 9001 is no longer published.
- **Copilot:** One dedicated screen for general and incident chat; the AI SRE popup is removed and support chat remains available. New chat preserves incident context. Authorized live sources default on in the UI and both chat APIs; API callers can send `useLiveConnectorTools=false` to disable them. General-chat connector results stay temporary; incident results are saved.
- **Self-hosting:** One main Compose file with optional `https` and `private-agent` profiles. HTTP evaluation binds to localhost; use HTTPS or SSH forwarding for remote access. Existing HTTPS commands remain supported through a compatibility file. Remote and Cloud-connected Private Agents retain their standalone setup.

- **AI providers:** GPT-6 Luna is the default, with DeepSeek V4.1 Flash available as an optional provider.
- **AI test dialogs:** Clearer creation guidance, visible API and k6 examples, and improved code-review and analysis layouts. Generated scripts remain available for review and editing before applying.
- **Queue reliability:** K6 submissions fail with `queue_unavailable` when no live matching worker heartbeat exists. Monitor enqueue/publication failures mark the monitor down and advance per-result failure counters; missing configured locations count toward All/majority aggregation. Bull Board shows retained and disabled queues plus SRE triage. Renewable serialization and durable per-group receipts make aggregation counters idempotent and allow retries to use saved final-failure evidence.
- **AI SRE setup:** Manual AI SRE is enabled when an AI provider is configured. Automatic incident triage is now opt-in: alerts still appear as signals and responders open incidents and run investigations manually, unless `SRE_AUTOMATION_ENABLED=true` is set in both app and worker. `SRE_ENABLED=false` disables AI SRE entirely.
- **Incident investigations:** Include stored evidence across types, including evidence collected from connectors that are now disabled. Correlation and staged evidence no longer need separate deployment flags; live connector access still requires authorization and consent.
- **Slack and Teams:** Inbound incident commands, bot replies, and the optional collaboration Compose overlay were removed; responders use authenticated dashboard or CLI sessions. Ordinary notifications and existing incident data are unchanged.
- **Execution and usage:** Recover unsettled Playwright and k6 usage after worker restarts without charging twice. Improve validation of database connection limits and k6 duration and virtual-user inputs.
- **Release reliability:** App, worker, Private Agent, and support-chat version reporting now reflect the deployed release. Execution jobs refresh mutable image tags so runs use the intended worker image.
- **Secrets:** Existing installs keep working: a `CHANGE_THIS`-style `SECRET_ENCRYPTION_KEY` is still accepted so stored secrets stay readable, but the app and worker log a warning. Generate a real key with `openssl rand -hex 32` for new installs; replacing the key on an existing install makes stored secrets unreadable until re-entered. `.env.example` documents this key instead of the unused `VARIABLES_ENCRYPTION_KEY` and `CREDENTIAL_ENCRYPTION_KEY`.
- **AI SRE reliability:** A recurring alert opens a new incident after the previous one is resolved. Failed automatic triage is retried, and concurrent triage returns a conflict instead of an error. Private Agent job results can no longer be overwritten by a replay, and expired connector credentials are never sent to agents. Agents refuse plain-HTTP API URLs outside local and private networks (localhost, private and link-local IPs, and `.svc`, `.internal`, `.local` names).
- **Private Agents:** Connector output redaction processes at most 64K characters per text value; stored excerpts retain their existing size cap. Matching result replays are acknowledged without replacing the saved result, and expired connector credentials report that the connector must be re-authenticated.
- **AI SRE CLI:** `sre triage` no longer times out early, rate limits fail fast, interrupted streams exit non-zero, and `incident resolve` requires `--force` in non-interactive sessions.
- **Deployment and security:** Remote workers now require `REDIS_PASSWORD`. Improve release validation, release API authentication, and dependency security across the app, worker, docs, and recorder.

**Upgrade note:** Automatic AI SRE incident triage is now off by default; deployments that relied on it must set `SRE_AUTOMATION_ENABLED=true` in both app and worker to keep it, and opt-outs are no longer needed. Otherwise existing deployments start unchanged. If yours still uses the default placeholder `SECRET_ENCRYPTION_KEY`, stored variables and connector credentials are protected by a publicly known key. Plan to set a real key (`openssl rand -hex 32`), then re-enter those values, because they cannot be decrypted with the new key. New installs generate a key with `./init-secrets.sh`. Apply the included database migrations before updating app and worker images, including `0024_execution_usage_receipts.sql`. Review existing AI SRE automation opt-outs: older per-workflow flags must be replaced with the two controls above. Remove `-f docker-compose-collaboration.yml` from existing Compose commands; Slack/Teams command credentials are no longer read.

## [CLI 0.3.1] - Unreleased
- **Script validation:** Parse k6 runtime imports during deploy, test, and job preflight checks, including same-line and multiline imports, while ignoring comments and type-only imports.

- **CLI setup:** `init` now prefills the authenticated organization and project IDs, with environment overrides and a warning if context is unavailable. `--skip-install` records required dev dependencies and tells you to install them manually; Playwright browsers still require `npx playwright install chromium`.

- **License:** The CLI is now Apache-2.0, with LICENSE and NOTICE included in the npm package. Earlier published versions retain their original license terms. The app and worker, including Private Agent mode, remain AGPL-3.0-only.
- **Agent workflows:** Add offline `skills`, config-schema, and capabilities commands; support account-free local test and job execution, cloud test execution, and waiting on existing runs. Improve JSON plans/results, confirmation handling, project-target checks, and deployment state tracking with generated resource IDs.
- **CLI reliability:** Redact Discord, Teams, and generic webhook credentials; preserve individual pull errors in human output; keep diagnostics usable with invalid project config; retire stale resource-name aliases; and preserve resumable run IDs on wait timeouts. Offline config commands require an existing file, while offline file-based test execution remains available without one.
- **Review hardening:** Keep monitor URLs and non-credential headers visible in output while masking credentials (provider and untyped configs fail closed); refuse to sync when the config's `api.baseUrl` differs from the active API origin and print the target before prompts; keep waiting through transient poll errors so a started run is not abandoned; recover deploy locks left by a dead process; capture the tail of large local runner output and parse large JSON reports; and add missing `.gitignore` entries for traces and backups to existing projects.
- **Pull and deploy safety:** `pull` accepts only UUID test IDs, keeps every write inside the project (including through symlinks), aborts if the server answers for a different test, and writes server test titles as a single comment line. Generated config now treats server strings as literals, never as `process.env` reads; secret variables link to environment variables only for ordinary names, and deploy never sends an empty secret value. Read-only commands skip the extra project-context request but still verify the declared API origin, which is now compared before `SUPERCHECK_URL` is applied.

## [CLI 0.3.0] - 2026-10-07

- **Investigation status:** Use `sre status <runId>` to check the lifecycle of an investigation in the current project.
- **Clearer output:** Add `--wide` and `--no-color`, readable detail tables, labeled investigation narratives, and elapsed progress.
- **Safer configuration sync:** `deploy` and `diff` preserve remote resources absent from the local configuration. Use `--delete` to explicitly request removal.
- **Pull previews:** Show resource counts and affected files, explain preserved local-only tests and skipped file variables, and disclose dependency installation before confirmation. Overwrite confirmation defaults to no; `--force` supports unattended pulls.
- **Automation output:** Make JSON and quiet output consistent, including authentication results and errors. Improve cleanup and exit handling for interrupted streams.
- **Reliability:** Fix terminal hangs, duplicated progress, truncated IDs, color escapes, and unclear validation, login, and network errors.

**Server compatibility:** Matching app and worker updates improve secret-safe Playwright console streaming and notification-name consistency, and preserve k6 threshold results when HTML export is unavailable.

## [CLI 0.2.1] - 2026-10-06

- Accept incident numbers in incident and AI SRE commands while retaining UUID support.
- Preserve the correct API URL during login and support read-only authentication.
- Return failing exit codes for failed executions and interrupted streams, and emit newline-delimited JSON for streaming output in JSON mode.
- Support synthetic and port-check monitor creation with input validation.
- Add monitoring-only health checks and clearer local-job and credential-storage guidance.

**Compatibility:** Older servers resolve incident numbers among their newest 500 incidents; updated servers support exact lookup. Updating the CLI does not update app or worker deployments.

## [1.3.6] - 2026-09-15

- **AI SRE:** Add incident management, service topology, investigations, Copilot, diagnostic recipes, and Private Agents.
- **API and CLI:** Add incident operations, service topology, Copilot chat, and evidence-brief streaming. Consolidate the CLI and Recorder with the main open-source project.
- **Integrations:** Expand support for Datadog, Sentry, Elasticsearch/OpenSearch, GitLab, PagerDuty, and Opsgenie.
- **Reliability:** Improve Kubernetes test execution and failure reporting, and fix usage synchronization for investigations, connectors, and reports.
- **Security:** Strengthen tenant isolation, permissions, outbound request safety, execution safeguards, and self-hosted secret generation.
- Remove the unsupported Coolify template. Self-hosting remains available through Docker Compose with K3s and gVisor.

## [CLI 0.2.0] - 2026-09-11

- Add AI SRE incident, service, and investigation commands.
- Improve test-source uploads and notification configuration drift detection.

## [CLI 0.1.3] - 2026-06-26

- Preserve notification secrets during configuration pull, diff, and deploy workflows.

## [CLI 0.1.2] - 2026-03-21

- Initial tracked release of `@supercheck/cli`.

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

**Self-hosted upgrade required:** Test execution now uses K3s and gVisor instead of the Docker socket. Run `setup-k3s.sh` on a supported Linux host before upgrading. Workers use a Kubernetes kubeconfig; existing tests and monitors do not need changes. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted).

- **Sandboxed execution:** Run user-submitted scripts in isolated gVisor execution pods with restricted permissions and network access.
- **Execution locations:** Super Admins can add, edit, and enable or disable locations. Workers discover regional queues dynamically, and projects can restrict available locations.
- **Worker reliability:** Improve queue discovery, heartbeat handling, stale-queue cleanup, and behavior when Redis is unavailable.
- **Email alerts:** Fix delivery to multiple comma-separated recipients and accurately report partial delivery failures.
- Strengthen worker container isolation and patch framework and parser vulnerabilities.

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

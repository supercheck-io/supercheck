# Changelog

Notable features, fixes, and upgrade requirements for Supercheck users. App and CLI releases are versioned separately.

## [Unreleased]
- **Execution:** Align saved-test and playground validation on syntax, size, complexity, and runner compatibility. Support Node.js APIs in isolated Playwright runs and async/named-scenario k6 scripts. Determine execution outcomes from Kubernetes exit status and preserve artifact collection.
- **Playwright:** Use the installed Playwright version for editor typing, retain traces and videos on failures and retries, and group HTML reports. Add four opt-in templates for diagnostics, passkeys, experimental Chromium WebMCP, and job-scoped test locks.
- **Playwright:** Upgrade app, worker, and E2E dependencies to 1.64.0 (Chromium 156, Firefox 157, WebKit 27.2). Hidden-iframe elements now count as hidden; `Locator.ariaRef()` is removed in favor of `ariaSnapshot()`, and `videosPath`/`videoSize` are replaced by `recordVideo`. Worker Firefox pins `screen` to 1280×720; saved tests that override the viewport must also set a matching `screen` for screen-sensitive checks.
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
- **Script validation:** Recognize k6 side-effect and multiline imports during deploy, test, and job preflight checks.

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

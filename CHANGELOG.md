# Changelog

Notable features, fixes, and upgrade requirements for Supercheck users. App and CLI releases are versioned separately.

## [Unreleased]

- **AI providers:** GPT-6 Luna is the default, with DeepSeek V4.1 Flash available as an optional provider.
- **AI test dialogs:** Clearer creation guidance, visible API and k6 examples, and improved code-review and analysis layouts. Generated scripts remain available for review and editing before applying.
- **AI SRE setup:** AI SRE and alert-triggered automation are enabled when an AI provider is configured. Use `SRE_ENABLED` and `SRE_AUTOMATION_ENABLED` to control manual AI features and automatic processing.
- **Incident investigations:** Include stored evidence across types, including evidence collected from connectors that are now disabled. Correlation and staged evidence no longer need separate deployment flags; live connector access still requires authorization and consent.
- **Slack and Teams:** Inbound incident commands, bot replies, and the optional collaboration Compose overlay were removed; responders use authenticated dashboard or CLI sessions. Ordinary notifications and existing incident data are unchanged.
- **Execution and usage:** Recover unsettled Playwright and k6 usage after worker restarts without charging twice. Improve validation of database connection limits and k6 duration and virtual-user inputs.
- **Release reliability:** App, worker, Private Agent, and support-chat version reporting now reflect the deployed release. Execution jobs refresh mutable image tags so runs use the intended worker image.
- **Deployment and security:** Remote workers now require `REDIS_PASSWORD`. Improve release validation, release API authentication, and dependency security across the app, worker, docs, and recorder.

**Upgrade note:** Apply the included database migrations before updating app and worker images, including `0024_execution_usage_receipts.sql`. Review existing AI SRE automation opt-outs: older per-workflow flags must be replaced with the two controls above. Remove `-f docker-compose-collaboration.yml` from existing Compose commands; Slack/Teams command credentials are no longer read.

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

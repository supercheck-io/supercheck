# Changelog

Highlights for Supercheck users. App and CLI releases are versioned separately.

## [Unreleased]

- Use GPT-6 Luna by default, with optional DeepSeek V4.1 Flash support.
- Improve AI test creation and review dialogs with clearer guidance and responsive layouts.
- Simplify AI SRE setup and enable automation when an AI provider is configured.
- Improve incident investigations, test execution reliability, usage tracking, and release version reporting.
- Update dependencies and strengthen authentication and deployment security.

**Upgrade note:** Apply the included database migrations before updating app and worker images, and review existing AI SRE automation opt-outs. Existing model overrides remain unchanged; set `AI_MODEL=gpt-6-luna` to switch to Luna.

## [CLI 0.3.0] - 2026-10-07

- Add investigation status checks and clearer command output.
- Make configuration sync safer: remote resources are preserved unless deletion is explicitly requested.
- Improve pull previews, confirmations, and JSON output.
- Fix terminal hangs, interrupted streams, and unclear validation errors.

## [CLI 0.2.1] - 2026-10-06

- Support incident numbers in incident and AI SRE commands.
- Improve login, read-only access, monitor creation, and health checks.
- Report failed commands and interrupted streams correctly.

## [1.3.6]

- Add AI SRE incidents, service topology, investigations, Copilot, diagnostic recipes, and Private Agents.
- Add AI SRE commands to the public API and CLI.
- Expand telemetry and incident integrations.
- Improve execution reliability, usage reporting, and tenant security.
- Remove the unsupported Coolify deployment template.

## [CLI 0.2.0] - 2026-09-11

- Add AI SRE incident, service, and investigation commands.
- Improve test-source uploads and configuration drift detection.

## [CLI 0.1.3] - 2026-06-26

- Preserve notification secrets during configuration sync.

## [CLI 0.1.2] - 2026-03-21

- Initial tracked release of `@supercheck/cli`.

## [1.3.5] - 2026-06-17

- Add customizable PagerDuty and Opsgenie webhooks and incident lifecycle actions.
- Add spending limits and clearer quota and payment errors.
- Fix webhook payload handling and update security dependencies.

## [1.3.4] - 2026-04-13

**Upgrade note:** Apply the included database migration before starting the upgraded app.

- Add configurable CORS for self-hosted integrations and reusable file variables for tests.
- Improve authentication, invitations, and self-hosted custom domains.
- Update security dependencies.

## [1.3.3] - 2026-03-22

**Self-hosted upgrade required:** Test execution now uses K3s and gVisor instead of the Docker socket. Run `setup-k3s.sh` on a supported Linux host before upgrading. Existing tests and monitors do not need changes. See the [deployment guide](https://supercheck.io/docs/app/deployment/self-hosted).

- Add sandboxed test execution and configurable execution locations.
- Improve worker reliability and multi-recipient alert emails.
- Strengthen execution isolation and update security dependencies.

## [1.3.2] - 2026-03-12

- Add self-hosted registration controls, organization renaming, and status page support links.
- Improve invitations, administration, and status page customization.
- Fix report loading and false capacity errors during Redis failover.
- Update security dependencies.

## [1.3.1] - 2026-02-25

- Add status page localization, badges, and calendar feeds.
- Improve signup, SMTP configuration, mobile layouts, and custom domains.
- Fix custom-domain removal and update security dependencies.

## [1.3.0] - 2026-02-16

- Introduce the Supercheck CLI and TypeScript test scripts.
- Add AI analysis for monitors and job runs.
- Improve invitations, documentation search, and secret handling.

## [1.2.3] - 2026-01-22

- Add the Edge Recorder extension, inverted monitor checks, and custom HTTP headers.
- Add a Coolify deployment template, later removed in 1.3.6.
- Improve test variable handling, alerts, and activity logs.

## [1.2.2] - 2026-01-17

- Add the Supercheck Recorder, document-based requirement extraction, and Microsoft Teams notifications.
- Add more AI providers and self-hosted custom-domain controls.
- Improve caching, PDF/DOCX extraction, and deployment security.

## [1.2.1] - 2025-12-17

- Add regional workers and live worker health checks.
- Improve dashboard loading, scheduling, and execution-time reporting.
- Fix authentication hydration, status counts, and background update reliability.

## [1.2.0] - 2025-11-16

- Add AI test creation and analysis, k6 performance testing, and execution analytics.
- Add status pages, custom domains, and incident subscriptions.
- Add self-hosting, team permissions, and stronger account security.
- Improve live execution updates, capacity controls, and usage tracking.

## [1.1.0] - 2025-09-22

- Add HTTP, host reachability, and port monitoring with configurable alerts.
- Add job scheduling, test variables, and Docker Compose deployment.
- Add configurable AI models.

## [1.0.0] - 2025-08-29

- Initial release with Playwright and API testing, execution reports, projects, teams, and authentication.

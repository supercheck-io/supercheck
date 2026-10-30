# Changelog

Notable changes to the Supercheck app and worker, including upgrade requirements for self-hosted installations. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The CLI is versioned separately; see [cli/CHANGELOG.md](cli/CHANGELOG.md). Prerelease builds (`-canary.N`) are not listed.

## [Unreleased]

## [1.5.0] - 2026-10-30

This release turns alerts and incidents into one flow (a failing monitor or job opens an incident, and recovery resolves it), adds incident assignment, acknowledgement and structured AI investigations, and extends AI SRE with more connectors. It also adds account avatars, an optional cookieless reports origin, a one-command self-hosted upgrade with backups, and a broad round of security, tenancy and correctness fixes.

### Upgrade notes

Read [Upgrade](https://supercheck.io/docs/app/deployment/self-hosted#upgrade) before upgrading a self-hosted installation.

- **Required secrets.** `docker-compose.yml` no longer falls back to built-in values for `DB_PASSWORD`, `REDIS_PASSWORD` and `BETTER_AUTH_SECRET` (and `docker-compose-external.yml` requires `BETTER_AUTH_SECRET`). Installer-created `.env` files already have them. If yours does not, Compose refuses to start and names the missing key: restore the `.env` you installed with, and never generate new values for an existing install.
- **Database TLS.** `sslmode` in `DATABASE_URL` is now honoured by the app, migrations and the worker. `require`, `verify-ca` and `verify-full` connect with a verified certificate, and `allow` and `prefer` try TLS first. An external PostgreSQL with a private certificate authority needs that CA trusted in the containers.
- **Image pins.** The bundled PostgreSQL and Redis images are pinned to `postgres:18.6` and `redis:8.10`, the versions the floating `18` and `8` tags pointed to.
- **Upgrading from v1.4.0.** Download the 1.5.0 `install.sh` and run `sudo bash install.sh --upgrade` on the server; it upgrades installer-created v1.4.0 installations directly. Installations from releases before 1.4.0 must first move from MinIO to RustFS (see 1.4.0).
- **Database migrations.** Apply migrations `0043` to `0046` before updating the app; older app versions ignore the new columns. `0044` deletes every external connector of a removed type (see Removed) and, through cascades, its credentials, service links, integration bindings and diagnostic queries. `0045` adds `runs.triggered_by_user_id` and builds an index without `CONCURRENTLY`, so writes to `runs` block briefly.
- **Deploy order.** Deploy the app before or together with the worker: an older app rejects the worker's new incident-recovery signal, so auto-resolve from recovery only starts once the app is updated, and Teams webhook rules are validated by both.
- **Effective project role is the lower of the org role and the project role.** One shared rule now applies to the dashboard, project-id routes, CLI tokens and run cancellation. A user demoted at the project level (for example org project editor, project viewer) is now a viewer on the dashboard too, and a project role higher than the org role no longer grants more than the org role anywhere. Org owners, org admins and super admins are not capped. Review project roles before upgrading.
- **Trigger keys follow their owner.** `POST /api/jobs/{id}/trigger` now returns 403 when the key's owner no longer has `job:trigger` on the job's project (demoted, removed, or the job has no project). Trigger keys and CLI tokens created with an expiring CLI token now expire with it.
- **Investigation Map removed.** `/copilot/evidence-graph` and its entry points are gone; cited evidence, linked alerts and similar incidents are on the incident page and dependencies are on the service page.
- **Removed connector types.** AI SRE connectors of type `opentelemetry`, `slack`, `teams`, `webhook`, `kafka`, `rabbitmq`, `appdynamics`, `postgresql`, `mysql`, `mongodb`, `redis` and `clickhouse` are removed, and migration `0044` deletes existing ones. Slack, Teams and webhook notification channels are unchanged. Diagnostic queries of type `sql` are no longer supported either.
- **Private Agents.** Upgrade Private Agents to the latest version: agents now report the connector types they support, and a job for a type an older agent does not support is refused with `private_agent_outdated` instead of jamming its queue.
- **Alerts moved.** `/alerts` and `/incidents?tab=alerts` redirect to `/notifications?tab=history`, and the dashboard `GET /api/dashboard` returns `jobs.failedRuns7d` instead of `recentFailures`.
- **Incident resolve needs a summary.** Resolving an incident requires a resolution summary; the REST resolve route still accepts `comment` for it.
- **Internal targets.** `ALLOW_INTERNAL_TARGETS` now opts in only when set to exactly `true`; before, `false` switched the guard off. Ping and port monitors on self-hosted Compose workers refuse hosts that resolve to a private address unless it is `true`.
- **k3s execution egress.** `setup-k3s.sh` now blocks the mail ports (25, 465, 587, 2525) and the host's Kubernetes control ports, and limits DNS to CoreDNS. `install.sh --upgrade` re-runs it (manual updates run it as in the guide); `EXECUTION_DNS_NAMESERVERS` also needs a matching rule in the execution egress policy.
- **Scheduled k6 jobs** must have exactly one test, and scripts whose literal options exceed 1000 VUs or 60 minutes are rejected before running.
- **New optional settings.** `REPORTS_ORIGIN` serves report HTML from a separate cookieless origin (unset keeps the current behaviour; it needs its own DNS and TLS and routing to the app). `SRE_DAILY_TOKEN_LIMIT_PER_ORG` caps AI SRE tokens per organization per day (default 2,000,000, `0` disables). `MAX_MONITOR_NOTIFICATION_CHANNELS` (default 10) is now also enforced on `POST /api/monitors/{id}/notifications`. `DB_BIND_ADDR`, `REDIS_BIND_ADDR` and `RUSTFS_BIND_ADDR` are described under Added.

### Added

- **Alerts open and resolve incidents.** A failing monitor or job opens one incident, later failures from the same source join it, and it resolves on its own when the source recovers (unless someone acknowledged it); a failure within 30 minutes reopens the same incident. Per monitor and job, `incidentEnabled` (default on), `incidentSeverity` (auto or `sev1` to `sev4`) and `autoResolveIncident` (default on) are available in the app, API, CLI config and OpenAPI. `GET /api/alerts/history` returns the linked `incident`, and incident responses carry a `statusLabel` (Triggered, Acknowledged, Investigating, Fixing, Monitoring, Resolved) while filters still take stored values.
- **Incident ownership.** Incidents have an assignee, an optional commander and an acknowledgement, with `POST /api/sre/incidents/{id}/assign` and `/acknowledge`, an `assignee` list filter, and a required resolution summary (pre-filled from the AI root cause). The incident list defaults to Active, with Assigned to me, Unassigned and All; open, assign, acknowledge, AI finding and resolve notify through the channels of the monitor or job that raised the alert. The assignee, the commander and a previous assignee also get a direct email when someone else changes the incident (at most once per 10 minutes for alert-driven changes).
- **Structured AI investigations.** An investigation returns a conclusion, confidence or an explicit Inconclusive outcome, ranked hypotheses with the evidence they cite, and next checks. Resolved incidents of the same project from the last 180 days appear as similar incidents. Right/Wrong feedback with an optional note, "Re-run with my note", and an editable post-mortem draft with Markdown export are on the incident page, whose investigation sheet has Analysis, Evidence, Brief, Similar and Post-mortem tabs.
- **More AI SRE connectors.** Jaeger, New Relic, Splunk, Google Cloud and Azure Monitor connectors give read-only live evidence search, directly or through a Private Agent. An MCP evidence connector runs only through a Private Agent: an admin discovers the server's tools and allowlists them, and investigations call only those, with output redacted and treated as untrusted.
- **Delivery history** is a tab on Notifications; a sent failure without an incident has an **Open incident** action. The sidebar groups pages under **Respond** (Dashboard, Incidents, Copilot, Services) and **Communicate** (Status Pages, Notifications).
- **Account dialog** replaces the Source code and Connected apps menu items: edit your name, upload or remove a profile photo (`POST` and `DELETE /api/users/me/avatar`: PNG, JPEG or WebP up to 2 MB), pick one of 24 preset avatars (`PUT /api/users/me/avatar`; everyone without a photo gets a default), see Connected apps when MCP is enabled, and **Leave organization** (moved from the profile menu). Profile photos from GitHub and Google sign-in show in tables.
- **Created by and Triggered by columns** on list tables. Runs record who triggered them: the user for manual and CLI runs, the trigger key name for trigger-key runs, or Schedule; older runs show Unknown. Runs, tests, jobs, monitors, requirements, variables and notification channels return the creator's name and image.
- **Optional cookieless reports origin.** With `REPORTS_ORIGIN` set, report HTML is served from that origin through signed, one-hour URLs from `POST /api/report-urls`, so generated report scripts never run on the app origin.
- List tables size their page to the window so pages do not scroll (Rows per page offers the fitted size plus 10, 25, 50 and 100); the dashboard's Needs attention is two bar charts (failed runs in the last 7 days by trigger, open incidents by severity) with live incident counts, and the Playground fills the window height.
- Organization and Super Admin settings put their tabs in the page header and use fit-to-window tables; CLI tokens are a table.
- MCP `list_incidents` and `get_incident` return assignee, commander, acknowledgement and resolution summary, and `get_incident` also returns `alertCount`. `get_job` and `get_monitor` return the incident settings, never the channels. The CLI gains matching incident, analytics, variable file, CLI token and project commands (see the CLI changelog).
- Supercheck Cloud sends server-side error reports from the app and worker to Sentry when `SENTRY_DSN` is set. A report has the error type, a shortened message scrubbed of secrets, URLs, email addresses, quoted text and database values, a stack trace, service (app or worker)/release/environment, OS and runtime versions, and internal IDs (hostnames and IPs in messages may appear); request contents, headers, cookies, form inputs, test scripts and run logs are not attached. Ignored when `SELF_HOSTED=true`, where the Sentry SDK is not loaded and no Sentry calls are made.
- The self-hosted installer measures free disk where Docker stores data, prompts whenever a terminal is available (including when output is piped), and in public mode warns about DNS that points elsewhere, a blocking `ufw` firewall, and HTTPS not answering after install. The `ufw` check understands port lists, ranges, application profiles, interface-scoped and IPv6 rules, and first-match order.
- `PATCH /api/tests/{id}/tags` and `PATCH /api/monitors/{id}/tags` add and remove individual tags atomically (`{"add": [...], "remove": [...]}`), so concurrent tag changes are not lost. `POST` (replace) and `DELETE` (clear) are unchanged.
- The requirements API accepts `"priority": null` to clear a requirement's priority.
- `sudo bash install.sh --upgrade [--version X]` upgrades an existing installation in one step: it checks the checkout, dumps the database, keeps a copy of `.env`, checks out the release, refreshes the sandbox, imports the worker image and restarts with a health check, then removes the previous release's app and worker images (going back means restoring a backup taken on that release, which pulls its images again). `--version X` on an existing installation now points to `--upgrade` for a newer release and to `backup.sh --restore` for an older one.
- `deploy/docker/backup.sh` backs up the database, stored files, HTTPS certificates and `.env`, and `backup.sh --restore DIR` restores them onto the same release after confirmation.
- Opt-in `compose.dns01.yml` issues a wildcard certificate for status-page subdomains through a DNS-01 challenge.
- `DB_BIND_ADDR`, `REDIS_BIND_ADDR` and `RUSTFS_BIND_ADDR` in `.env` publish PostgreSQL, Redis and RustFS for remote workers without editing the Compose file.

### Changed

- Every email uses one layout (wordmark, dark header, one button colour, details table). The team incident email carries the event message, an incident details table and an open-incident button, and Slack, Teams, Discord and Telegram incident messages use Slack attachments, Teams Adaptive Cards, Discord embeds and readable Telegram text instead of one plain line.
- People are shown the same way everywhere with a shared avatar and name cell: photo or preset avatar, otherwise two-letter initials on a per-person colour, with the email in a tooltip. Dense columns (audit log user, CLI token and trigger key "Created by", incident assignee) show the avatar only, and dates use one compact cell with the full timestamp on hover.
- The incident detail page has one scroll, a single **Details** card and one Resolve action. AI reports render as formatted text with only http(s) links.
- Copilot chat (`/api/sre/chat/assistant-ui`) is no longer available during the trial, like the other chat, evidence brief and post-mortem routes.
- `POST /api/sre/investigate` returns 403 when `useLiveConnectors` is true and the caller lacks `sre_connector:investigate`, instead of silently dropping it.
- Synthetic monitors cannot run more often than every 5 minutes through the API and CLI, matching the form.
- Stored k6 console output keeps its start and its end, so threshold and error lines survive. Dashboard Browser minutes, Job status, Job activity and 30-day run counts count Playwright job runs only; k6 stays on the k6 cards.
- Docs are synced with the app and use one page layout; the docs site opens in light mode.

### Fixed

- **Monitors and alerts.**
  - Monitor checks skipped because no worker is live in any expected location (such as during a deployment rollout) are no longer recorded as Down, for scheduled and immediate runs. With `MISSING_CYCLE_CLOSURE_ENABLED=true`, regions skipped at enqueue no longer get synthetic Down rows at the cycle deadline, and the deadline for synthetic checks no longer uses the 30 s HTTP default.
  - Multi-location monitors send their first failure alert on the threshold cycle after `pending`, not one cycle later; the first failure alert no longer waits five checks after a skipped pending observation.
  - A failed result save now retries the job without re-running the check, and partial email delivery is no longer re-sent up to five times. SMTP sends the rendered subject, Telegram alerts for names with `_` or `*` are delivered, and Discord and Teams cards no longer drop content. k6 timeouts can trigger the job timeout alert.
  - Alerts for user-cancelled job runs are no longer sent and do not count in failure streaks.
  - Editing a monitor keeps settings the form does not show (timeouts, retry strategy, Playwright options, website method, regions) and a custom check interval set through the CLI or API. Names, request bodies, keywords, headers and credentials are saved exactly as entered. Monitor charts never round uptime up to 100% and show failed checks as gaps instead of 0 ms. Viewers opening a monitor's edit page are taken to its details.
  - Monitor and job write paths accept only allowlisted fields, check that a synthetic monitor's test belongs to the project, apply one alert-config normaliser (recovery alerts default on, thresholds 1 to 100), and validate job cron expressions in one place.
  - A scheduled check for a deleted monitor removes its leftover repeatable schedule.
- **Incidents and AI SRE.**
  - Incident snapshots keep the failure that opened them, so an older incident no longer shows a newer failure's message, severity and time; a failure that returns after recovery is noted as such, and a failure that fired before automatic recovery no longer reopens the incident.
  - Investigation runs left `running` by a lost process are failed after 5 minutes so a retry no longer returns 409. The evidence brief no longer flips a resolved incident back to investigating.
  - The incident list is capped at 500 with a note, and assign, acknowledge, resolve and update are limited to 30 per minute per user and incident (429 with `Retry-After`).
  - `POST /api/alerts/history` now requires `monitor:manage` and `sre_incident:update`, and its `monitorId` or `jobId` must belong to the caller's project.
  - SRE routes no longer return raw error messages to clients, an oversized Copilot message returns 413, and chat history is trimmed to fit. A Private Agent result that fails schema validation fails its job instead of being leased again.
  - Private Agent leasing skips disabled connectors and jobs queued longer than 10 minutes, registering or disabling org-wide Private Agents needs an org-level permission, and evidence is redacted when stored.
  - AI SRE investigations that fail or are cancelled no longer count toward the trial allowance.
- **Jobs and runs.**
  - `POST /api/jobs/run` runs the job's saved tests (the request `tests` field no longer decides), and `GET /api/executions/running` needs run view permission and is scoped to the caller's project. The trigger route no longer refuses jobs whose status is `error`, and new jobs always start `pending`.
  - The scheduler advances the next run on skipped ticks, removes schedules of deleted projects and cleared jobs, and records one `blocked` run per blocked period. A job's status follows its latest run, and runs queued for 30 minutes with no queue entry are recovered.
  - The Runs page loads up to 1000 runs, shows queued, cancelled and blocked runs correctly and says when the list is truncated. The job edit page detects concurrent edits and fills the full width again.
  - Report and asset files stream and support Range requests (video seeking and Safari playback work), and S3 responses default to private caching.
  - Scheduled k6 jobs are validated like manual runs, a k6 process that exits before writing a summary is recorded as an execution error, and the k6 report viewer no longer hangs on "Reconnecting".
- **Tests, Playground and AI.**
  - AI Fix finds the report for Playwright tests (it looked under the test id instead of the run id) and no longer opens an empty dialog. AI Fix and AI Create show a cut-off or failed generation as an error instead of success, and AI routes return 429 when rate limited.
  - A cancelled run's status stream can no longer overwrite the next run; a run whose report never arrives ends as failed after 15 minutes. The editor asks before you leave with unsaved changes.
  - `PUT` and `PATCH /api/tests/{id}` check the request origin for browser sessions, validate title and description, and are scoped by project. Test search is case-insensitive with literal `%` and `_`.
  - Requirements: linking or unlinking tests recomputes coverage status, uploaded documents are checked by magic bytes and removed when extraction fails, and bulk delete validates IDs.
  - AI features (test creation and repair, job, k6 and monitor analysis) no longer use an AI credit when the provider fails, returns nothing, or the request is cancelled before any output; credits are reserved before the call, so the limit holds under parallel requests.
- **Status pages.** Webhook and Slack failures count once per delivery, a successful test or resubscribe clears quarantine, deleting a component or incident no longer widens a scoped subscriber to all, and the public components payload no longer includes monitor names, ids or status. Public pages fail loudly instead of showing "All Systems Operational" when data fails to load, list every unresolved incident above the components and let open incidents set the banner, apply custom background, font and border colours, and show maintenance windows. Unverified custom-domain reservations are released after 7 days.
- **Organization admin and notifications.** Members and CLI tokens list hides actions the server would refuse, renaming a CLI token to a name in use and a duplicate project slug return 409, and project updates and deletes are audited. Teams URLs are validated against the hosts the worker sends to (Power Automate URLs can be saved; `outlook.office.com` and `*.azurewebsites.net` are rejected at save), notification test sends are limited to 20 per 10 minutes, and Slack, Discord, Teams and Telegram messages go through DNS-pinned public fetch. Failed sends show their reason in Delivery history.
- **UI.** Lists show an error with Retry instead of an empty list when a load fails, and note when the API cap is reached. The status page preview shows uptime again, a project role above the member's organization role is no longer saved and silently capped, and the invitation member cap, pending-invitation usage count and spending percentage are corrected.
- `PUT /api/jobs/{id}` accepts an `alertConfig` without `enabled`, `notificationProviders`, `alertOnFailure` or the thresholds, so a job pulled and deployed by the CLI can be updated. The job in the URL is always the one updated, even if the body carries another `jobId`.
- `PUT /api/jobs/{id}` keeps any `alertConfig` field the request omits at its stored value (for example `alertOnFailure: false`); create defaults apply only when no alert config is stored.
- `POST /api/cli/project-config/deploy` rejects more than 500 notification providers or SRE bindings per request.
- MCP `list_runs` returns the newest runs first (ordered by creation time, cursor format unchanged), and `get_monitor` reports the monitor's configured locations with `locationStrategy` and `locationThreshold`. `list_incidents` accepts `severity`, and `list_tests` accepts `type`, `priority` and `search`.
- `POST` and `PATCH` on `/api/tests/{id}/tags` and `/api/monitors/{id}/tags` return 400 instead of 500 when a tag is deleted between validation and insert. Test tag changes are audited like monitor tag changes.
- MCP requests that stall while uploading their body now fail with 408 after 15 seconds and release their concurrency slots.
- A queued trial run is no longer failed when only another run's in-flight reservation puts it over the allowance; it stays queued until that run settles. An expired trial entitlement now counts as having no remaining allowance, as in the worker. Trial allowance checks before queueing subtract runs that are still in flight, matching worker admission.
- Usage alert emails at the warning thresholds follow the user's alert toggles; the limit-reached email is always sent. A trial reminder whose delivery succeeded but whose sent-marker write failed transiently is no longer resent.
- Incident analytics charts, the sidebar's outline menu button and the response-time chart's tooltip cursor use valid colors (the `hsl()` wrappers around oklch tokens are removed).
- A run decrypts only the project secrets its script uses, so one unreadable secret no longer fails every run in the project. A run that uses an unreadable secret fails with `422 VARIABLES_UNRESOLVED` naming the key.
- Renaming a variable to an existing key returns the same error as creating it, variable updates and deletes are scoped to their project, and cached decrypted secrets are cleared after a save so the edit dialog cannot write back an old value.
- Self-hosting: the Postgres healthcheck uses the configured user, the worker's ineffective restart policy is removed so it comes back after a reboot, and `setup-k3s.sh` adds a changed host IP to the k3s API certificate on re-run.

### Security

- Secret values are scrubbed from Playwright and k6 plain-text report files (HTML, JSON, text, Markdown, XML; plain, Base64, URL-encoded, JSON- and HTML-escaped forms) before upload. Traces, screenshots, videos and data embedded in the Playwright HTML report are not scrubbed.
- Variable create, update, delete, secret conversion and secret reveal are recorded in the audit log (keys only, never values). The variable edit dialog no longer decrypts a secret when it opens.
- Worker: `fast-uri` override raised to 3.1.9 (GHSA-w74x-v6f9-j3xg and related advisories in the build tooling chain); recorder dev dependencies refreshed. `npm audit` reports 0 vulnerabilities for app, worker, recorder, docs and cli.
- Accounts and credentials: a suspended approver can no longer mint a CLI key through device login, session auth honours `banExpires`, and a CLI token cannot create a CLI token or trigger key that outlives it. Only a token's owner can re-enable it. Removing a member or leaving an organization disables their trigger keys. Deleted projects no longer resolve for CLI tokens and no longer count toward limits.
- Admin and invitations: the sole owner of an organization with other members and the last super admin cannot be deleted or demoted, unban is audited, cancelling an invitation is guarded against a concurrent accept, and notification test emails are limited to the caller or organization members with a per-user rate limit.
- Ping, TCP/UDP port and website SSL monitor probes resolve the host once and connect to that address, and refuse hosts that resolve to a private address.
- Profile updates are checked server-side: name and image changes are refused while impersonating, and `image` may only be unchanged, null, or the user's own avatar route, so arbitrary URLs are never loaded by other users' browsers. Avatar objects are pruned on replace, removal and user deletion.
- Private Agents block more cloud metadata endpoints (AWS IPv6, Alibaba, Azure, Oracle) and NAT64, 6to4 and IPv4-compatible IPv6 forms, cap connector responses at 10 MB, and cannot have their token rotated while impersonating; jobs whose connector moved to another agent, organization or project are failed so the old agent never receives the credential.
- The investigation prompt fences the incident title and stored evidence as untrusted text.
- Generated report documents get a sandbox CSP unless loaded in the in-app viewer.

### Removed

- The Investigation Map and its entry points; see Upgrade notes.
- AI SRE connector types that cannot be searched (`opentelemetry`, `slack`, `teams`, `webhook`, `kafka`, `rabbitmq`, `appdynamics`, `postgresql`, `mysql`, `mongodb`, `redis`, `clickhouse`) and the `sql` diagnostic query type. A stored connector of another unsupported type is blocked by validation and never sent anywhere.
- The Signals view on Incidents, and the Alerts section on the dashboard.

### Recorder

- Settings are simpler: one **Sign in to Supercheck** button, with the self-hosted instance URL and API key under collapsible sections and no hostnames shown. The help popover is regrouped as Record, Inspect and Code.
- `https://supercheck.io` is no longer a trusted origin for the extension; it is the marketing and docs site.
- Saving hands the recorded code to the Playground the recorder was opened from, keeps the recording if the hand-off fails, and sends it only to the recorded Supercheck origin with an acknowledgement. The key is stored in local storage (existing synced keys migrate), at most five keys stay enabled, and auto-connect no longer overwrites a saved self-hosted instance.
- The unused direct "Save to Supercheck" surface is removed.

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

[Unreleased]: https://github.com/supercheck-io/supercheck/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/supercheck-io/supercheck/compare/v1.4.0...v1.5.0
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

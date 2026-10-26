# Changelog

Notable changes to `@supercheck/cli`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Server changes are listed in the [Supercheck changelog](https://github.com/supercheck-io/supercheck/blob/main/CHANGELOG.md).

## [Unreleased]

### Fixed

- `test tag add` and `test tag remove` now send an atomic per-tag change (`PATCH /api/tests/<id>/tags`) instead of replacing the whole set, so concurrent tag changes are no longer lost. Older servers fall back to the previous read-then-replace. Removing an unknown tag is now a no-op.
- `deploy --verify` now names the failed verification runs (title and run ID) in the human-readable error, not only in `--json` output.
- `deploy` checks requirement support with a validation-only `POST /api/requirements` instead of exporting every requirement (which also wrote an export audit event). A status page route's own JSON 404 is no longer mistaken for an old server.
- `deploy` rejects a test or monitor with more than 10 distinct tags before any write, instead of saving the resource and then failing to apply its tags.
- Requirement `externalUrl` in config must be an `http://` or `https://` URL, matching the server.

- `deploy` removes a status page draft it just created when applying its settings, components or status then fails (for example a custom domain the plan or server rejects), so no orphan draft is left behind. The original error is shown; if the cleanup itself fails, a warning names the draft and the error still reports its ID. Pages that existed before the run are never deleted.

### Security

- Upgraded `zod` to ^4.6.7, fixing GHSA-mrhx-c7xc-m3w5. `supercheck schema config` constraint entries now use zod 4's shape (for example `{"check":"min_length","minimum":1}`). Resource `id` values in config and `supercheck.state.json` must now be RFC 4122 UUIDs, matching the server; ids the server issued already are.

### Added

- `run delete <id>` (`DELETE /api/runs/<id>`, confirms unless `--force`) and `dashboard` (`GET /api/dashboard`) for project metrics. Status-page incident create/update/delete is not included: the app exposes it only as server actions, not a REST route.
- A requirement's `priority` can be cleared from config with `priority: ""`. This needs a server that accepts a null priority (the release after 1.4.0); an older server rejects that write with a 400.

## [0.4.0] - 2026-10-26

Requirements, status pages, test priority and tags now work from the terminal and as code. Requirements, status page writes and monitor tags need Supercheck 1.4.0 or later; on an older server the CLI stops with an upgrade hint before it writes anything.

### Added

- **Browser sign-in.** `supercheck login` opens the browser, you approve a short code and choose the project; there is no token to copy. `login --json` returns the URL and code at once and finishes on the next call (`--wait` blocks, `--no-browser` suits headless machines, `--reauth` switches accounts). Needs a server with browser login enabled (`DEVICE_AUTH_ENABLED=true`, migration `0032`); otherwise the CLI explains how to use `login --token`. Token login and `SUPERCHECK_TOKEN` are unchanged.
- **Guided setup.** `onboard` (read-only status and the next step), `discover` (repository facts without running anything), `link` (point `supercheck.config.ts` at the project you are logged in to), `plan` (subscription state), `ci init --github` and `agent install --target claude|cursor|codex|opencode|generic`.
- **Agent guides.** `supercheck skills onboarding|authoring|ci|safety`, bundled in the package so they work offline.
- **`deploy --verify`.** After a successful deploy, runs each created or updated browser test once in the cloud and waits for the result (at most 5 tests; performance tests never run implicitly).
- **Requirements.** `requirement list|get|create|update|delete|link|unlink|coverage|export` (alias `requirements`), and `requirements[]` in `supercheck.config.ts` with `pull`, `diff`, `deploy` and `destroy`. Omitted `tags` or `tests` leave the remote value alone and `[]` clears it; `""` clears `description`, `externalId` or `externalUrl`. Tag names compare case-insensitively, and tags that do not exist yet are created by the server. Remote requirements are compared, and pruned by `deploy --delete`, only when the config has a `requirements` key, so dashboard requirements are never pruned by a config that does not manage them.
- **Status pages as code.** Settings (headline, description, support contact, language, timezone, custom domain, status), branding (12 `#RRGGBB` colors), notifications and components with monitor references. `subdomain` is read-only (pulled, never sent). When a page declares `components`, remote components missing from the list are removed only with `deploy --delete`; omitting `components` leaves them all alone.
- **Test priority and tags.** `test create|update|list --priority`, `test tag add|remove <id> <tags...>`, and `@priority` / `@tags` annotations that `pull` writes into test files and `deploy` applies (`@priority` accepts any letter case). Monitors take `tags` in config, deployed and pulled. Test and monitor tags must exist or be declared under `tags`.
- `job update <id> --tests <ids...>` replaces the tests in an existing job, with `--dry-run` support.
- `doctor --strict` exits non-zero unless dependencies, config and verified credentials are all in place. `incident list --status open` lists every unresolved incident.
- `diff --json` includes `hasChanges` and a `summary`.

### Changed

- **Behavior change:** `SUPERCHECK_TOKEN`, `SUPERCHECK_URL`, `SUPERCHECK_TRIGGER_KEY`, proxy settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, ...) and TLS settings (`NODE_TLS_REJECT_UNAUTHORIZED`, ...) are no longer read from a project's `.env` file, so a cloned repository cannot choose your credential, where it is sent, or how the connection is protected. Export them in your shell or CI secret store, or run `supercheck login`. A config that reads `process.env.SUPERCHECK_URL` needs it exported rather than kept in `.env`.
- **Behavior change:** status page `notifications` flags have no defaults; an omitted flag leaves the remote value unchanged instead of resetting it.
- **Validation change:** `tags` on jobs (never applied) now fails validation.
- `test create --file` and `test update --file` strip the local `@title`, `@priority` and `@tags` annotations before sending the script, as `deploy` does.
- `deploy` checks before its first write that every referenced test and monitor exists in the project (and, with `--delete`, is not about to be deleted), that status page fields are within the server's limits, and that a new published page declares a component, so these mistakes no longer leave a half-created page.
- `doctor` reads `supercheck.config.ts` as text instead of running it, verifies credentials against the API, and reports a config that targets another API instead of a rejected token. `--fix` still runs `npx playwright install`, so use it only in repositories you trust.
- `logout` says that it removes the key from this machine only; revoke the key under CLI Tokens to invalidate it.
- JSON errors consistently include `code`, `retryable` and `nextActions`. A 401 exits with the authentication code on every command, and a 409 maps to `CONFLICT`. Missing local script files use configuration exit code 3; missing variables use API exit code 4 and `NOT_FOUND`. `whoami` with an expired or revoked key returns `TOKEN_INVALID`.
- `requirement export --json` without `--output` prints `{ "format": "csv", "content": "..." }` instead of raw CSV. `export` never overwrites a file without `--force`, never writes through a symbolic link, and leaves the file readable only by you.
- `login --wait` keeps waiting through a dropped connection or slow response once the code is shown. Requests allow 30 seconds, adjustable with `SUPERCHECK_REQUEST_TIMEOUT_MS` (5000 to 120000).
- Read commands enforce the configured organization and project. Script validation keeps the configured API target without requiring a matching project.

### Fixed

- `pull` stops without writing when the config declares `requirements` but the server has no requirements API, instead of rewriting the config without them. It writes `@tags` for every test (the tags were dropped when the script was fetched separately), refuses symlinked config destinations and writes outside the project, masks monitor URL and request credentials by default, and refuses to deploy masked credentials. Use `--show-secrets` only when those credentials must be exported.
- An empty string in a status page or requirement field no longer shows as a change on every `diff`.
- Job updates reject missing or invalid test IDs before writing, including when `--tests` consumes `--dry-run`. Cron expressions, monitor URLs, resource IDs and pagination are validated, and `--envelope` requires `--json`.
- `run get` and `run list` return the application report URL instead of the internal storage host.
- Plain `login` resumes an approved `--reauth` grant.
- Deployment locks are published only after their owner information is written, so an interrupted lock creation cannot leave an empty lock that blocks later deploys.

## [0.3.2] - 2026-10-18

0.3.1 was not published; its changes ship in 0.3.2.

### Added

- **Agent workflows.** Offline `skills`, `schema config` and `capabilities` commands; account-free local test and job execution; cloud test execution; and waiting on existing runs. JSON plans and results, confirmation handling, project-target checks and deployment state tracking with generated resource IDs are improved.
- **`init` prefills the project.** `init` fills in the authenticated organization and project IDs, with environment overrides and a warning if the context is unavailable. `--skip-install` records the required dev dependencies and tells you to install them; Playwright browsers still need `npx playwright install chromium`.

### Changed

- **License.** The CLI is now Apache-2.0, with `LICENSE` and `NOTICE` included in the npm package. Earlier published versions keep their original license terms. The app and worker, including Private Agent mode, remain AGPL-3.0-only.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC).

### Fixed

- k6 detection works when identical script content is parsed repeatedly, including duplicate scripts in one command. Syntax diagnostics for invalid k6 scripts are kept, and duplicated request-size error text is removed.
- k6 runtime imports are parsed during deploy, test and job preflight checks, including same-line and multiline imports, while comments and type-only imports are ignored.
- `sre triage` no longer times out early, rate limits fail fast, interrupted streams exit non-zero, and `incident resolve` requires `--force` in non-interactive sessions.
- Discord, Teams and generic webhook credentials are redacted. Individual pull errors are kept in human output, diagnostics stay usable with an invalid project config, stale resource-name aliases are retired, and resumable run IDs survive wait timeouts. Offline config commands require an existing file, while offline file-based test execution works without one.
- Monitor URLs and non-credential headers stay visible in output while credentials are masked (provider and untyped configs fail closed). Syncing stops when the config's `api.baseUrl` differs from the active API origin, and the target is printed before prompts. Waiting continues through transient poll errors so a started run is not abandoned. Deploy locks left by a dead process are recovered. The tail of large local runner output is captured and large JSON reports are parsed. Missing `.gitignore` entries for traces and backups are added to existing projects.

### Security

- `pull` accepts only UUID test IDs, keeps every write inside the project (including through symlinks), aborts if the server answers for a different test, and writes server test titles as a single comment line. Generated config treats server strings as literals, never as `process.env` reads; secret variables link to environment variables only for ordinary names, and deploy never sends an empty secret value. Read-only commands skip the extra project-context request but still verify the declared API origin, which is now compared before `SUPERCHECK_URL` is applied.

### Server compatibility

- k6 validation on the server rejects scripts with no default export or `scenarios` entry point, while dynamic scenario options still pass. This takes effect once your Supercheck instance is upgraded.

## [0.3.0] - 2026-10-07

- **Investigation status.** `sre status <runId>` shows the lifecycle of an investigation in the current project.
- **Clearer output.** `--wide` and `--no-color`, readable detail tables, labeled investigation narratives and elapsed progress.
- **Safer configuration sync.** `deploy` and `diff` keep remote resources that are absent from the local configuration; use `--delete` to remove them.
- **Pull previews.** Resource counts and affected files, notes on preserved local-only tests and skipped file variables, and disclosure of dependency installation before confirmation. Overwrite confirmation defaults to no; `--force` supports unattended pulls.
- **Automation output.** JSON and quiet output are consistent, including authentication results and errors. Cleanup and exit handling for interrupted streams are improved.
- **Reliability.** Fixes terminal hangs, duplicated progress, truncated IDs, color escapes, and unclear validation, login and network errors.

**Server compatibility:** matching app and worker updates improve secret-safe Playwright console streaming and notification-name consistency, and keep k6 threshold results when HTML export is unavailable.

## [0.2.1] - 2026-10-06

- Incident and AI SRE commands accept incident numbers as well as UUIDs.
- Login keeps the correct API URL and supports read-only authentication.
- Failed executions and interrupted streams return failing exit codes, and streaming output in JSON mode is newline-delimited JSON.
- Synthetic and port-check monitors can be created, with input validation.
- Monitoring-only health checks, and clearer local-job and credential-storage guidance.

**Compatibility:** older servers resolve incident numbers among their newest 500 incidents; updated servers support exact lookup. Updating the CLI does not update app or worker deployments.

## [0.2.0] - 2026-09-11

- AI SRE incident, service and investigation commands.
- Improved test-source uploads and drift detection for notification configuration.

## [0.1.3] - 2026-06-26

- Notification secrets are preserved during configuration `pull`, `diff` and `deploy`.

## [0.1.2] - 2026-03-21

- First tracked release of `@supercheck/cli`.

[Unreleased]: https://github.com/supercheck-io/supercheck/compare/cli-v0.4.0...HEAD
[0.4.0]: https://github.com/supercheck-io/supercheck/compare/cli-v0.3.2...cli-v0.4.0
[0.3.2]: https://github.com/supercheck-io/supercheck/compare/cli-v0.2.1...cli-v0.3.2
[0.2.1]: https://github.com/supercheck-io/supercheck/releases/tag/cli-v0.2.1

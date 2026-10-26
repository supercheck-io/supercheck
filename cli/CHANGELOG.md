# Changelog

## 0.4.0 - 2026-10-26

Requirements, status pages, test priority and tags now work from the terminal and as code. Requirements, status page writes and monitor tags need a Supercheck server with the matching APIs; on an older server the CLI stops with an upgrade hint before it writes anything.

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

- `pull` writes `@tags` for every test (the tags were dropped when the script was fetched separately), refuses symlinked config destinations and writes outside the project, masks monitor URL and request credentials by default, and refuses to deploy masked credentials. Use `--show-secrets` only when those credentials must be exported.
- An empty string in a status page or requirement field no longer shows as a change on every `diff`.
- Job updates reject missing or invalid test IDs before writing, including when `--tests` consumes `--dry-run`. Cron expressions, monitor URLs, resource IDs and pagination are validated, and `--envelope` requires `--json`.
- `run get` and `run list` return the application report URL instead of the internal storage host.
- Plain `login` resumes an approved `--reauth` grant.
- Deployment locks are published only after their owner information is written, so an interrupted lock creation cannot leave an empty lock that blocks later deploys.

## 0.3.2 - 2026-10-18

- Fix CLI k6 detection when identical script content is parsed repeatedly, including duplicate scripts in one command.
- Preserve syntax diagnostics for invalid k6 scripts and remove duplicated request-size error text.
- Server-side: k6 validation now rejects scripts with no default export or `scenarios` entry point, while dynamic scenario options still pass. Takes effect once your Supercheck instance is upgraded.
- Publish CLI releases from GitHub Actions using npm trusted publishing (OIDC).

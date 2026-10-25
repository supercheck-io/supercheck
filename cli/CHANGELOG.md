# Changelog

## Unreleased

- Sign in through the browser with `supercheck login`: approve a short code and pick the project, with no token to copy. `login --json` returns the URL and code at once and finishes on the next call (add `--wait` to block, `--no-browser` for headless machines, `--reauth` to switch accounts). Requires a server with browser login enabled (`DEVICE_AUTH_ENABLED=true` and migration `0032`); otherwise the CLI explains how to use `login --token`. Token login and `SUPERCHECK_TOKEN` are unchanged.
- Add `onboard` (read-only status and the next step), `discover` (repository facts without running anything), `link` (point `supercheck.config.ts` at the project you are logged in to), `plan` (subscription state), `ci init --github` and `agent install --target claude|cursor|codex|opencode|generic`.
- Add `deploy --verify`: after a successful deploy, run each created or updated browser test once in the cloud and wait for the result (performance tests are never run implicitly; at most 5 tests).
- Add versioned agent guides `supercheck skills onboarding|authoring|ci|safety`, bundled in the package so they work offline.
- JSON errors consistently include `code`, `retryable` and `nextActions`, including config, argument, file and token failures. Missing local script files use configuration exit code 3; missing variables use API exit code 4 and `NOT_FOUND`.
- `pull` refuses symlinked config destinations and writes outside the project, masks monitor URL and request credentials by default, and refuses to deploy masked credentials. Use `--show-secrets` only when those credentials must be exported.
- Plain `login` resumes an approved `--reauth` grant. Job updates reject missing or invalid test IDs before mutation, including when `--tests` consumes `--dry-run`; cron, monitor URLs, resource IDs and pagination are validated, and `--envelope` requires `--json`.
- Read commands enforce the configured organization and project. Script validation retains the configured API target without requiring a matching project; absolute display paths are preserved.
- Server-side MCP initialization returns sanitized JSON-RPC `-32602` errors for invalid parameters, including single-message batches.
- **Behavior change:** `SUPERCHECK_TOKEN`, `SUPERCHECK_URL`, `SUPERCHECK_TRIGGER_KEY`, proxy settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, ...) and TLS settings (`NODE_TLS_REJECT_UNAUTHORIZED`, ...) are no longer read from a project's `.env` file, so a cloned repository cannot choose your credential, where it is sent, or how the connection is protected. Export them in your shell or CI secret store, or run `supercheck login`. A config that reads `process.env.SUPERCHECK_URL` needs it exported rather than kept in `.env`.
- `login --wait` keeps waiting through a dropped connection or slow response once the code has been shown (it stops only on a final answer or its own `--timeout`); requests to the server now allow 30 seconds, adjustable with `SUPERCHECK_REQUEST_TIMEOUT_MS` (5000 to 120000). `whoami` with an expired or revoked key now returns the stable `TOKEN_INVALID` code and next steps in JSON mode.
- `doctor` now reads `supercheck.config.ts` as text instead of running it (it still runs `npx playwright install` with `--fix`, so use `--fix` only in repositories you trust). `logout` now says that it removes the key from this machine only; revoke the key under CLI Tokens to invalidate it.

- Add `requirement list|get|create|update|delete|link|unlink|coverage|export` (alias `requirements`) and a `requirements[]` section in `supercheck.config.ts` with `pull`, `diff`, `deploy` and `destroy` support. Omitted `tags` or `tests` leave the remote value alone and `[]` clears it; tag names compare case-insensitively.
- Status pages now deploy as code: settings (headline, description, support URL, language, timezone, custom domain, status), branding (12 `#RRGGBB` colors), notifications and components with monitor references. `subdomain` is read-only (pulled, never sent) and remote-only components are removed only with `deploy --delete`.
- **Behavior change:** status page `notifications` flags have no defaults any more; an omitted flag leaves the remote value unchanged instead of resetting it.
- **Validation change:** `tags` is no longer accepted on jobs (it was never applied), so a config containing it now fails validation. Monitors take `tags` in config, deployed and pulled.
- Add `test create|update --priority`, `test list --priority`, `test tag add|remove <id> <tags...>`, and `@priority` / `@tags` annotations that `pull` writes into test files and `deploy` applies.
- Requirements, status page writes and monitor tags need a Supercheck server that includes the new API; on an older server the CLI fails with an upgrade hint before the first write (requirements, status pages and monitor tags when an existing monitor can be probed) or, for a monitor tag step with nothing to probe, right after that monitor's create. Test and monitor tags must exist or be declared under `tags` (checked before any write); requirement tags are created by the server.
- Add `job update <id> --tests <ids...>` to replace the tests in an existing job, including dry-run support.

- Publish deployment locks only after their owner information is written, so an interrupted lock creation cannot leave an empty lock that blocks later deploys.

## 0.3.2 - 2026-10-18

- Fix CLI k6 detection when identical script content is parsed repeatedly, including duplicate scripts in one command.
- Preserve syntax diagnostics for invalid k6 scripts and remove duplicated request-size error text.
- Server-side: k6 validation now rejects scripts with no default export or `scenarios` entry point, while dynamic scenario options still pass. Takes effect once your Supercheck instance is upgraded.
- Publish CLI releases from GitHub Actions using npm trusted publishing (OIDC).

# Changelog

## Unreleased

- Sign in through the browser with `supercheck login`: approve a short code and pick the project, with no token to copy. `login --json` returns the URL and code at once and finishes on the next call (add `--wait` to block, `--no-browser` for headless machines, `--reauth` to switch accounts). Requires a server with browser login enabled (`DEVICE_AUTH_ENABLED=true` and migration `0032`); otherwise the CLI explains how to use `login --token`. Token login and `SUPERCHECK_TOKEN` are unchanged.
- Add `onboard` (read-only status and the next step), `discover` (repository facts without running anything), `link` (point `supercheck.config.ts` at the project you are logged in to), `plan` (subscription state), `ci init --github` and `agent install --target claude|cursor|codex|opencode|generic`.
- Add `deploy --verify`: after a successful deploy, run each created or updated browser test once in the cloud and wait for the result (performance tests are never run implicitly; at most 5 tests).
- Add versioned agent guides `supercheck skills onboarding|authoring|ci|safety`, bundled in the package so they work offline.
- JSON errors now include a stable `code`, `retryable` and suggested `nextActions`; existing `error` strings and exit codes are unchanged.
- **Behavior change:** `SUPERCHECK_TOKEN`, `SUPERCHECK_URL`, `SUPERCHECK_TRIGGER_KEY`, proxy settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, ...) and TLS settings (`NODE_TLS_REJECT_UNAUTHORIZED`, ...) are no longer read from a project's `.env` file, so a cloned repository cannot choose your credential, where it is sent, or how the connection is protected. Export them in your shell or CI secret store, or run `supercheck login`. A config that reads `process.env.SUPERCHECK_URL` needs it exported rather than kept in `.env`.
- `doctor` now reads `supercheck.config.ts` as text instead of running it (it still runs `npx playwright install` with `--fix`, so use `--fix` only in repositories you trust). `logout` now says that it removes the key from this machine only; revoke the key under CLI Tokens to invalidate it.

- Add `job update <id> --tests <ids...>` to replace the tests in an existing job, including dry-run support.

- Publish deployment locks only after their owner information is written, so an interrupted lock creation cannot leave an empty lock that blocks later deploys.

## 0.3.2 - 2026-10-18

- Fix CLI k6 detection when identical script content is parsed repeatedly, including duplicate scripts in one command.
- Preserve syntax diagnostics for invalid k6 scripts and remove duplicated request-size error text.
- Server-side: k6 validation now rejects scripts with no default export or `scenarios` entry point, while dynamic scenario options still pass. Takes effect once your Supercheck instance is upgraded.
- Publish CLI releases from GitHub Actions using npm trusted publishing (OIDC).

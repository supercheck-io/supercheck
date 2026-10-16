# Supercheck CLI

Manage tests, monitors, scheduled jobs, and AI SRE from your terminal or CI. Supports Supercheck Cloud and self-hosted installations.

[![npm](https://img.shields.io/npm/v/@supercheck/cli)](https://www.npmjs.com/package/@supercheck/cli) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/supercheck-io/supercheck/blob/main/cli/LICENSE)

## Installation

Requires Node.js 20 or later.

```bash
npm install -g @supercheck/cli
# Or run without installing globally:
npx @supercheck/cli --help
```

Upgrade an existing installation with `supercheck upgrade`.

## Quick start

Create a project-scoped CLI token in **Organization Admin → CLI Tokens**.

```bash
supercheck login --token <cli-token>
supercheck init
supercheck pull
supercheck diff
supercheck deploy
```

For self-hosted instances, add `--url https://your-supercheck.example.com` to login. In CI, use `SUPERCHECK_TOKEN` from your secret store. Locally stored credentials are obfuscated, not encrypted.

### Agent quick start

Use `supercheck skills` for the offline workflow index and `supercheck skills <topic>` for focused guidance. `supercheck skills install` creates a small `.agents/skills/supercheck/SKILL.md` pointer without replacing an existing file unless `--force` is supplied. `supercheck schema config --json` describes config fields, and `supercheck capabilities --json` reports local CLI capabilities. `capabilities --online` verifies the current API context, but does not determine every server feature or permission.

Local test execution needs no Supercheck account or credentials:

```bash
supercheck test run --offline --file ./_supercheck_/playwright/homepage.pw.ts
supercheck job run --id "Nightly E2E" --local --offline
```

Offline runs use local Playwright or k6 dependencies and skip cloud validation. Browser tests need the project’s browser binaries; pass `--playwright-config <path>` to use an existing Playwright config.

**Deploy preserves resources absent from local config by default.** To prune them, preview `supercheck diff --delete`, then apply `supercheck deploy --delete`. This also deletes resources created outside the config. `destroy` targets resource IDs present in config or local test filenames.

## Architecture

![Supercheck CLI reads project config, calls the Cloud or self-hosted API, and runs tests locally or through execution workers. The API provides AI SRE investigation and Copilot.](https://raw.githubusercontent.com/supercheck-io/supercheck/main/cli/assets/architecture.png)

Local Playwright and k6 runs require their respective dependencies. Use `supercheck doctor` to check your setup.

## Common commands

| Task | Commands |
| --- | --- |
| Learn the CLI | `skills`, `skills local`, `skills sync`, `skills execute`, `skills investigate` |
| Inspect capabilities and config fields | `capabilities --json`, `capabilities --online --json`, `schema config --json` |
| Inspect resources | `monitor list`, `test list`, `job list`, `run list` |
| Resource details | `monitor get <id>`, `test get <id>`, `job get <id>` |
| Sync configuration | `pull`, `diff`, `deploy`, `config validate` |
| Run tests | `test run --file <path>`, `test execute <id>`, `job run --id <id>` |
| Follow execution | `run wait <run-id>`, `run stream <run-id>`, `run status <run-id>`, `run cancel <run-id>` |
| Manage project settings | `var`, `tag`, `notification` |
| Inspect incidents | `incident list`, `incident get <number-or-uuid>`, `incident timeline <number-or-uuid>`, `incident resolve <number-or-uuid> --comment <text>` |
| Investigate | `sre triage <incident>`, `sre investigate <incident>`, `sre status <runId>` |
| Ask Copilot | `sre ask "What needs attention?"`, `sre brief <incident>` |
| Inspect services | `service list`, `service get <id>`, `service health <id>`, `service dependencies <id>` |
| Diagnose | `doctor`, `health`, `whoami` |

Prefix commands with `supercheck`. Use `supercheck <command> --help` or the [full command reference](https://supercheck.io/docs/cli/commands) for CRUD options, filters, and limits. Status-page sync supports reads and deletions; creation and updates use the dashboard.

## Configuration

Define resources in `supercheck.config.ts`:

```typescript
import { defineConfig } from '@supercheck/cli'

export default defineConfig({
  schemaVersion: '1.0',
  project: { organization: 'organization-id', project: 'project-id' },
  monitors: [{
    name: 'API Health',
    type: 'http_request',
    target: 'https://api.example.com/health',
    frequencyMinutes: 5,
  }],
})
```

Deploy stores server-assigned resource IDs, including replacement IDs when a tracked remote resource was deleted and recreated, in `supercheck.state.json`, scoped to the API origin, organization, and project. Commit and share this file with CI so later deploys manage the same resources. The transient `supercheck.state.json.lock` coordinates deploys only on a shared local filesystem; do not commit it. Resource names alone do not establish ownership: pull existing resources or supply explicit IDs. Renaming an ID-less non-test resource requires an explicit ID or a pull; names do not establish ownership. The CLI checks configured organization and project against the authenticated API context before sync. Monitor/job tag assignments are rejected before writes; standalone tag management remains available.

Deploy validates test scripts before applying changes. See the [configuration guide](https://supercheck.io/docs/cli/configuration) for test discovery, secrets, and notification providers.

`pull` copies remote resources into local files and can overwrite matching test scripts and `supercheck.config.ts`. It preserves managed test paths and existing browser/`testMatch` settings. Runner-type changes migrate files with mode-`0600` backups; new tests use compatible custom globs or pull fails before writing. Before overwriting changed scripts or config, pull saves a backup at `<path>.supercheck-backup.<uuid>`. Its JSON summary includes `files` and `backups` arrays. Local-only test scripts are preserved, including files whose remote tests were deleted; deploy can recreate those tests without renaming their local paths. Check `pull --dry-run` before pulling and `diff` before deploying. Use `pull --config-only` to skip test scripts or `pull --tests-only` to leave config untouched. Confirmation defaults to no; use `--force` for unattended pulls. If `package.json` is missing, pull also initializes project dependencies.

## CI/CD

Store a job trigger key in `SUPERCHECK_TRIGGER_KEY`. Add a CLI token in `SUPERCHECK_TOKEN` when using `--wait` to read the result.

```bash
supercheck --json job trigger <job-id> --wait
```

A failed run exits nonzero. See [CI/CD examples](https://supercheck.io/docs/cli/ci-cd) for GitHub Actions, GitLab CI, and Docker.

## Output and environment

| Option | Behavior |
| --- | --- |
| `--json` | Structured JSON output; paginated lists keep array responses by default. Streaming and local runs emit NDJSON. Errors are JSON on stderr. |
| `--envelope` | Include pagination metadata with JSON list results; requires `--json`. |
| `--show-secrets` | Explicitly disable sensitive-field redaction in output. |
| `--quiet` | Resource/run IDs only; narrative streams are suppressed. `--json` takes precedence. |
| `--wide` | Remove table and narrative width limits. |
| `--no-color` | Disable ANSI colors; `NO_COLOR` is also supported. |
| `--debug` | Enable diagnostics. |

Lists and details use tables. Triage separates run metadata from its summary; Copilot answers and evidence briefs use labeled narratives. Redirected output has no colors or spinners. Ctrl+C during a stream exits 130; idle timeouts exit 5.

An operation that needs confirmation in a non-interactive session exits `3` with `CONFIRMATION_REQUIRED`; review the plan and explicitly pass `--force`. Authentication errors remain exit code `2`. `--show-secrets` deliberately exposes sensitive values; avoid it in shared logs or transcripts.

Use `SUPERCHECK_URL` for a self-hosted API and `SUPERCHECK_TOKEN` for project-scoped access. HTTP proxies use `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. Check the active API URL and project with `supercheck whoami`.

## Compatibility

AI SRE requires a configured server AI provider. Live connectors require explicit `--live-connectors` consent and permissions. `sre status` requires an app release that provides the investigation-status endpoint.

## Documentation and contributing

- [CLI documentation](https://supercheck.io/docs/cli/commands)
- [Manual release instructions](https://github.com/supercheck-io/supercheck/blob/main/cli/RELEASING.md)
- [Changelog](https://github.com/supercheck-io/supercheck/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/supercheck-io/supercheck/blob/main/CONTRIBUTING.md) · [Security policy](https://github.com/supercheck-io/supercheck/blob/main/SECURITY.md)

From version 0.3.1, licensed under [Apache-2.0](https://github.com/supercheck-io/supercheck/blob/main/cli/LICENSE). The npm package includes LICENSE and NOTICE. Earlier published versions retain their original licenses.

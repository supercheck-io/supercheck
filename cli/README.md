# Supercheck CLI

Manage tests, monitors, scheduled jobs, and AI SRE from your terminal or CI. Supports Supercheck Cloud and self-hosted installations.

[![npm](https://img.shields.io/npm/v/@supercheck/cli)](https://www.npmjs.com/package/@supercheck/cli) [![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](https://github.com/supercheck-io/supercheck/blob/main/LICENSE)

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

**Deploy preserves resources absent from local config by default.** To prune them, preview `supercheck diff --delete`, then apply `supercheck deploy --delete`. This also deletes resources created outside the config. `destroy` targets resource IDs present in config or local test filenames.

## Architecture

![Supercheck CLI reads project config, calls the Cloud or self-hosted API, and runs tests locally or through execution workers. The API provides AI SRE investigation and Copilot.](https://raw.githubusercontent.com/supercheck-io/supercheck/main/cli/assets/architecture.png)

Local Playwright and k6 runs require their respective dependencies. Use `supercheck doctor` to check your setup.

## Common commands

| Task | Commands |
| --- | --- |
| Inspect resources | `monitor list`, `test list`, `job list`, `run list` |
| Resource details | `monitor get <id>`, `test get <id>`, `job get <id>` |
| Sync configuration | `pull`, `diff`, `deploy`, `config validate` |
| Run tests | `test run --file <path>`, `job run --id <id>` |
| Follow execution | `run stream <id>`, `run status <id>`, `run cancel <id>` |
| Manage project settings | `var`, `tag`, `notification` |
| Inspect incidents | `incident list`, `incident get <number-or-uuid>`, `incident timeline <number-or-uuid>` |
| Investigate | `sre triage <incident>`, `sre investigate <incident>`, `sre status <runId>` |
| Ask Copilot | `sre ask "What needs attention?"`, `sre brief <incident>` |
| Inspect services | `service list`, `service get <id>`, `service health <id>` |
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

`pull` populates existing resource IDs for subsequent updates. Deploy validates test scripts before applying changes. See the [configuration guide](https://supercheck.io/docs/cli/configuration) for test discovery, secrets, and notification providers.

`pull` copies remote resources into local files and can overwrite matching test scripts and `supercheck.config.ts`. Local-only test scripts are preserved, including files whose remote tests were deleted; `deploy` can recreate those tests with new IDs. Check `pull --dry-run` before pulling and `diff` before deploying. Use `pull --config-only` to skip test scripts or `pull --tests-only` to leave config untouched. Confirmation defaults to no; use `--force` for unattended pulls. If `package.json` is missing, pull also initializes project dependencies.

## CI/CD

Store a job trigger key in `SUPERCHECK_TRIGGER_KEY`. Add a CLI token in `SUPERCHECK_TOKEN` when using `--wait` to read the result.

```bash
supercheck --json job trigger <job-id> --wait
```

A failed run exits nonzero. See [CI/CD examples](https://supercheck.io/docs/cli/ci-cd) for GitHub Actions, GitLab CI, and Docker.

## Output and environment

| Option | Behavior |
| --- | --- |
| `--json` | Complete JSON payloads; streaming commands emit NDJSON. Errors are JSON on stderr. |
| `--quiet` | Resource/run IDs only; narrative streams are suppressed. `--json` takes precedence. |
| `--wide` | Remove table and narrative width limits. |
| `--no-color` | Disable ANSI colors; `NO_COLOR` is also supported. |
| `--debug` | Enable diagnostics. |

Lists and details use tables. Triage separates run metadata from its summary; Copilot answers and evidence briefs use labeled narratives. Redirected output has no colors or spinners. Ctrl+C during a stream exits 130; idle timeouts exit 5.

Use `SUPERCHECK_URL` for a self-hosted API and `SUPERCHECK_TOKEN` for project-scoped access. HTTP proxies use `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. Check the active API URL and project with `supercheck whoami`.

## Compatibility

AI SRE requires a configured server AI provider. Live connectors require explicit `--live-connectors` consent and permissions. `sre status` requires an app release that provides the investigation-status endpoint.

## Documentation and contributing

- [CLI documentation](https://supercheck.io/docs/cli/commands)
- [Manual release instructions](https://github.com/supercheck-io/supercheck/blob/main/cli/RELEASING.md)
- [Changelog](https://github.com/supercheck-io/supercheck/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/supercheck-io/supercheck/blob/main/CONTRIBUTING.md) · [Security policy](https://github.com/supercheck-io/supercheck/blob/main/SECURITY.md)

Licensed under [AGPL-3.0-only](https://github.com/supercheck-io/supercheck/blob/main/LICENSE). The npm package includes the license.

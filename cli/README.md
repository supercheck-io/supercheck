# @supercheck/cli

CLI for Supercheck testing, monitoring, and reliability workflows.

[![npm version](https://img.shields.io/npm/v/@supercheck/cli.svg)](https://www.npmjs.com/package/@supercheck/cli)
[![License](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

The Supercheck CLI is open source under the GNU Affero General Public License v3.0 only (AGPL-3.0-only), matching the app and worker.

The Supercheck CLI provides a first-class command-line interface for managing your testing and monitoring infrastructure as code. It is designed for CI/CD integration, automation, and power-user workflows.

## Features

- **Monitoring-as-Code**: Define monitors, tests, jobs, and status pages in TypeScript.
- **CI/CD Integration**: Trigger jobs and wait for results directly from your pipeline.
- **Full Resource Management**: Manage all resources (tests, monitors, jobs, variables, tags, notifications) from the terminal.
- **Local Development**: Run and debug tests locally before deploying.
- **Security-First**: Token scanning in config files, SHA-256 hashed storage, prefix-validated authentication.
- **Proxy Support**: Full HTTP/HTTPS proxy support with `NO_PROXY` awareness via `undici`.

## Installation

```bash
npm install -g @supercheck/cli
```

Or run directly with `npx`:

```bash
npx @supercheck/cli --help
```

## Upgrade

Upgrade the CLI to the latest release:

```bash
supercheck upgrade
```

## Quick Start

1. **Initialize a new project**:
   ```bash
   supercheck init
   ```
  This creates a `supercheck.config.ts` and a `_supercheck_` directory with example tests under `_supercheck_/playwright` and `_supercheck_/k6`.

2. **Authenticate**:
   ```bash
   supercheck login --token sck_live_...
   ```
   You can generate a CLI token in your Dashboard under **Project Settings > CLI Tokens**.

3. **Pull existing resources**:
   ```bash
   supercheck pull
   ```

4. **Preview & Deploy**:
   ```bash
   supercheck diff
   supercheck deploy
   ```

5. **Validate scripts**:
  ```bash
  supercheck validate
  ```
  Validation runs automatically during deploy and cannot be skipped.

6. **Run tests locally (optional)**:
  ```bash
  supercheck test run --file _supercheck_/playwright/homepage-check.<id>.pw.ts
  supercheck test run --all --type browser
  supercheck test run --all --type performance
  supercheck test run --all --type api
  supercheck test run --all --type database
  supercheck test run --all --type custom
  ```

  For remote execution with persisted run history, trigger a job:
  ```bash
  supercheck job run --id <job-id>
  # or (CI/CD trigger key flow)
  SUPERCHECK_TRIGGER_KEY=sck_trigger_... supercheck job trigger <job-id>
  ```

  `supercheck job trigger` requires `SUPERCHECK_TRIGGER_KEY`. If you also pass `--wait`, set `SUPERCHECK_TOKEN` so the CLI can poll the resulting run.

## Command Reference

### Authentication

| Command | Description |
|---|---|
| `supercheck login --token <token>` | Authenticate with a CLI token |
| `supercheck logout` | Clear stored credentials |
| `supercheck whoami` | Show current authentication context |

### Monitoring-as-Code

| Command | Description |
|---|---|
| `supercheck init` | Initialize a new project with config and example tests |
| `supercheck pull` | Sync cloud resources to local config |
| `supercheck diff` | Preview changes between local config and cloud |
| `supercheck deploy` | Apply local config changes to the cloud |
| `supercheck validate` | Validate local test scripts (same rules as Playground) |
| `supercheck destroy` | Remove all managed resources from the cloud (`--dry-run`, `--force`) |
| `supercheck config validate` | Validate your `supercheck.config.ts` |
| `supercheck config print` | Print resolved `supercheck.config.ts` |

> Note: In the current API, status pages are readable/deletable from CLI sync flows, but create/update endpoints are not available.
> Pull preserves non-default status page language values (for example `es`, `fr`) for config visibility.

> Note: Self-hosted email/password sign-in is for dashboard access. CLI authentication remains token-based (`supercheck login --token ...`).

### Jobs & Runs

| Command | Description |
|---|---|
| `supercheck job list` | List all jobs |
| `supercheck job get <id>` | Get job details |
| `supercheck job create --name <name> --tests <test-id...>` | Create a new job with tests (`--dry-run`) |
| `supercheck job update <id> --name ...` | Update job fields (`--dry-run`) |
| `supercheck job delete <id>` | Delete a job |
| `supercheck job keys <jobId>` | List trigger keys for a job |
| `supercheck job keys create <jobId> --name <name>` | Create a trigger key |
| `supercheck job keys delete <jobId> <keyId>` | Revoke a trigger key |
| `supercheck job run --id <job-id>` | Run a job immediately |
| `supercheck job run --local` | Run a job locally using local test files |
| `supercheck job trigger <id> --wait` | Trigger a job with a trigger key and wait for completion (CI/CD) |
| `supercheck run list` | List recent execution runs (`--job`, `--status`, `--page`, `--limit`) |
| `supercheck run get <id>` | Get run details |
| `supercheck run status <id>` | Get run status |
| `supercheck run permissions <id>` | Get run permissions |
| `supercheck run stream <id>` | Stream live console output |
| `supercheck run cancel <id>` | Cancel a running execution |

### Tests & Monitors

| Command | Description |
|---|---|
| `supercheck test list` | List all tests (`--search`, `--type`, `--page`, `--limit`) |
| `supercheck test get <id>` | Get test details (`--include-script`) |
| `supercheck test create` | Create a new test (`--dry-run`) |
| `supercheck test update <id>` | Update a test (`--dry-run`) |
| `supercheck test delete <id>` | Delete a test |
| `supercheck test validate` | Validate local test scripts (same rules as Playground) |
| `supercheck test run` | Run tests locally |
| `supercheck test tags <id>` | List tags for a test |
| `supercheck test status <id>` | Stream live status events for a test |
| `supercheck monitor list` | List all monitors |
| `supercheck monitor get <id>` | Get monitor details |
| `supercheck monitor results <id>` | Get monitor check results |
| `supercheck monitor stats <id>` | Get monitor statistics |
| `supercheck monitor status <id>` | Get current monitor status |
| `supercheck monitor create ...` | Create a monitor (`--interval-minutes`, `--dry-run`) |
| `supercheck monitor update <id> ...` | Update a monitor (`--interval-minutes`, `--dry-run`) |
| `supercheck monitor delete <id>` | Delete a monitor |

> **Dry run support:** `test create`, `test update`, `job create`, `job update`, `monitor create`, `monitor update`, and `deploy` all support `--dry-run` to preview the API payload without making changes.

`supercheck test run` is local-only. Cloud test execution has been replaced by `supercheck job run` / `supercheck job trigger`.

### Variables, Tags & Notifications

| Command | Description |
|---|---|
| `supercheck var list / get / set / delete` | Manage project variables (`var set` supports `--value-stdin` for secrets) |
| `supercheck tag list / create / delete` | Manage tags |
| `supercheck notification list / get / create / update / delete / test` | Manage notification providers |
| `supercheck alert history` | View alert history |
| `supercheck audit` | View audit logs (admin) |

`supercheck notification test` validates an ad-hoc provider configuration before creation or update. It does not take an existing provider ID.

```bash
supercheck notification test --type slack --config '{"webhookUrl":"https://hooks.slack.com/..."}'
```

### Utilities

| Command | Description |
|---|---|
| `supercheck health` | Check API health |
| `supercheck locations` | List available execution locations |
| `supercheck doctor` | Validate local CLI dependencies and config (`--fix`) |
| `supercheck upgrade` | Upgrade the CLI to the latest release |

## Configuration

The `supercheck.config.ts` file is the source of truth for your project configuration.

```typescript
import { defineConfig } from '@supercheck/cli'

export default defineConfig({
  schemaVersion: '1.0',
  project: {
    organization: 'my-org-id',
    project: 'my-project-id',
  },
  tests: {
    playwright: {
      testMatch: '_supercheck_/playwright/**/*.pw.ts',
    },
    k6: {
      testMatch: '_supercheck_/k6/**/*.k6.ts',
    },
  },
  monitors: [
    {
      name: 'API Health',
      type: 'http_request',
      target: 'https://api.example.com/health',
      frequencyMinutes: 5,
    }
  ]
})
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run E2E Tests
  run: npx @supercheck/cli --json job trigger ${{ secrets.SUPERCHECK_JOB_ID }} --wait
  env:
    SUPERCHECK_TRIGGER_KEY: ${{ secrets.SUPERCHECK_TRIGGER_KEY }}
    SUPERCHECK_TOKEN: ${{ secrets.SUPERCHECK_TOKEN }}
```

`SUPERCHECK_TRIGGER_KEY` is required to start the run. `SUPERCHECK_TOKEN` is only needed here because the example uses `--wait`.

### GitLab CI

```yaml
test:
  image: node:18
  script:
    - npm install -g @supercheck/cli
    - supercheck job trigger $SUPERCHECK_JOB_ID --wait
  variables:
    SUPERCHECK_TRIGGER_KEY: $SUPERCHECK_TRIGGER_KEY
    SUPERCHECK_TOKEN: $SUPERCHECK_TOKEN
```

## Environment Variables

| Variable | Description |
|---|---|
| `SUPERCHECK_TOKEN` | CLI token for authentication (CI/CD) |
| `SUPERCHECK_TRIGGER_KEY` | Trigger key for `job trigger` |
| `SUPERCHECK_URL` | Custom API URL (self-hosted) |
| `SUPERCHECK_ORG` | Override organization ID from config |
| `SUPERCHECK_PROJECT` | Override project ID from config |
| `HTTPS_PROXY` | Proxy URL for HTTPS requests |
| `HTTP_PROXY` | Proxy URL for HTTP requests |
| `NO_PROXY` | Hosts to bypass proxy (comma-separated) |

## Global Options

| Flag | Description |
|---|---|
| `--json` | Output in JSON format |
| `--quiet` | Suppress non-essential output |
| `--debug` | Enable debug logging |
| `-v, --version` | Show CLI version |

Config-aware commands such as `config`, `diff`, `deploy`, `pull`, `validate`, and `destroy` accept `--config <path>`.

## Links

- [Website](https://supercheck.io)
- [CLI Documentation](https://supercheck.io/docs/cli/commands)
- [App Documentation](https://supercheck.io/docs/app/welcome)
- [GitHub](https://github.com/supercheck-io/supercheck)

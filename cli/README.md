# Supercheck CLI

Manage Supercheck tests, monitors, jobs, requirements, status pages, and AI SRE from your terminal or CI, and keep them in version control. Works with Supercheck Cloud and self-hosted installations.

[![npm version](https://img.shields.io/npm/v/@supercheck/cli)](https://www.npmjs.com/package/@supercheck/cli)
[![npm downloads](https://img.shields.io/npm/dm/@supercheck/cli)](https://www.npmjs.com/package/@supercheck/cli)
[![Node.js](https://img.shields.io/node/v/@supercheck/cli)](https://nodejs.org)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/supercheck-io/supercheck/blob/main/cli/LICENSE)

- **Monitoring as code.** Define monitors, tests, jobs, requirements, status pages, variables, tags, and notification providers in `supercheck.config.ts`, then `diff` and `deploy`.
- **Run tests anywhere.** Execute Playwright and k6 tests locally with no account, or on Supercheck execution workers.
- **Built for automation.** Structured JSON output, stable exit codes, and explicit confirmation rules for CI and AI agents.
- **AI SRE.** Triage incidents, start investigations, and ask read-only reliability questions.

![Supercheck CLI reads project config, calls the Cloud or self-hosted API, and runs tests locally or through execution workers. The API provides AI SRE investigation and Copilot.](https://raw.githubusercontent.com/supercheck-io/supercheck/main/cli/assets/architecture.png)

## Installation

Requires Node.js 20 or later.

```bash
npm install -g @supercheck/cli

# or run without installing
npx @supercheck/cli --help
```

Run `supercheck doctor` to check your local setup.

### Upgrade

`supercheck upgrade` updates a global install. With npm directly:

```bash
npm install -g @supercheck/cli@latest                # global install
npm install --save-dev @supercheck/cli@latest        # project-local install
supercheck --version
```

## Quick start

Sign in through your browser (or create a project-scoped CLI token in **Organization → CLI Tokens** and use `supercheck login --token <cli-token>`), then:

```bash
supercheck login     # opens your browser; approve the code shown in the terminal
supercheck init      # scaffold supercheck.config.ts and example tests
supercheck pull      # copy existing cloud resources into local files
supercheck diff      # preview changes
supercheck deploy    # apply them
```

For self-hosted instances, add `--url https://your-supercheck.example.com` to `login`. In CI, set `SUPERCHECK_TOKEN` from your secret store instead. Locally stored credentials are obfuscated, not encrypted.

When logged in, `supercheck init` fetches your current organization and project IDs to prefill the generated config. `SUPERCHECK_URL` overrides the stored login URL, and `SUPERCHECK_ORG` or `SUPERCHECK_PROJECT` override the matching IDs. If context cannot be loaded, init warns and uses fallback values; check the IDs in `supercheck.config.ts` before deploying. Use `supercheck init --skip-install` to record the required dev dependencies without installing them, then run your package manager's install command. Playwright browsers still need `npx playwright install chromium`.

Update the tests in an existing job with `supercheck job update <job-id> --tests <test-id> <test-id>`. Add `--dry-run` to inspect the replacement before saving it.

## Run tests locally

Local runs need no Supercheck account, token, or network access to Supercheck:

```bash
supercheck test run --offline --file ./_supercheck_/playwright/homepage.pw.ts
supercheck test run --offline --all --type performance
supercheck job run --local --offline --id "Nightly E2E"
```

Playwright tests need `@playwright/test` and its browsers (`npx playwright install chromium`); performance tests need [k6](https://k6.io). Pass `--playwright-config <path>` to reuse your application's Playwright config. `supercheck doctor` reports missing dependencies. Without `--offline`, local runs still validate scripts against your Supercheck project first.

## Validate test scripts

Validate the tests in the current suite, or check one k6 script explicitly:

```bash
supercheck validate
supercheck test validate --file ./_supercheck_/k6/example.k6.ts --type performance
```

k6 scripts must use the `performance` test type and either export a default function or configure named entrypoints in `options.scenarios`. Validation checks script syntax and type compatibility through the configured Supercheck API; it does not run the test. Use `supercheck test run --offline --all` for local execution, where runtime failures are detected.

## Configuration

Resources are declared in `supercheck.config.ts`:

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
  requirements: [{
    title: 'Users can reset their password',
    priority: 'high',
    tests: ['_supercheck_/playwright/reset-password.pw.ts'],
  }],
  statusPages: [{
    name: 'Acme Status',
    status: 'published',
    components: [{ name: 'API', monitors: ['API Health'] }],
  }],
})
```

`supercheck schema config --json` describes every supported field, and `supercheck config validate` checks a file. Typed objects reject unknown fields. See the [configuration guide](https://supercheck.io/docs/cli/configuration) for test discovery, secrets, requirements, status pages, and notification providers.

## Deploying safely

`diff` and `deploy --dry-run` show the plan without changing anything. Before any sync, the CLI checks that the configured organization, project, and `api.baseUrl` match the API you are authenticated against, and prints the target.

- **Nothing is deleted by default.** Resources absent from your config are left alone. Use `diff --delete` to preview and `deploy --delete` to prune. This also removes resources created outside the config.
- **Ownership is explicit.** Names alone never establish ownership. If a same-named resource exists remotely but is not tracked, deploy stops: `pull` it or add its `id`.
- **State.** Deploy records server-assigned IDs in `supercheck.state.json`, scoped to API origin, organization, and project. Commit it and share it with CI so later deploys manage the same resources. The transient `supercheck.state.json.lock` guards concurrent deploys on one filesystem; do not commit it.
- **Checked before writing.** Test and monitor references, tags, server limits, and server support for each resource type are checked before the first write, so most mistakes stop the deploy before anything changes.
- **Dependencies.** New tests are created before the jobs, synthetic monitors, requirements, and status pages that reference them.
- **Renames.** Renaming an ID-less non-test resource creates a new one; carry its `id` or `pull` first to update in place.
- **Secrets.** Secret variable values are never written to config. A secret variable with no value is not sent, so an unset environment variable cannot overwrite a stored secret.

## Pulling from the cloud

`pull` copies remote resources into local files and preserves local-only test scripts. Check `pull --dry-run` first.

- Changed test scripts, renamed or migrated test files, and `supercheck.config.ts` are backed up to `<path>.supercheck-backup.<uuid>` (mode `0600`) before being overwritten. Backups are kept until you remove them.
- Use `--config-only` to skip scripts or `--tests-only` to leave config untouched.
- Confirmation defaults to no; pass `--force` for unattended runs.
- Pulled files stay inside your project, and server text is written as literal data, never as code or environment reads.

## Common commands

| Task | Commands |
| --- | --- |
| Learn the CLI | `skills`, `skills local`, `skills sync`, `skills configure`, `skills execute`, `skills investigate` |
| Inspect the CLI | `capabilities [--online]`, `schema config`, `doctor`, `whoami`, `health` |
| Sync configuration | `pull`, `diff`, `deploy`, `destroy`, `config validate`, `config print` |
| Run tests | `test run`, `test execute <id> --wait`, `job run --id <id>`, `job trigger <id> --wait` |
| Follow a run | `run wait <id>`, `run stream <id>`, `run status <id>`, `run cancel <id>`, `run delete <id> [--force]`, `dashboard` |
| Inspect resources | `test list`, `monitor list`, `job list`, `run list`, `monitor results <id>` |
| Manage resources | `test` (incl. `--priority`, `tag add/remove`), `monitor`, `job`, `requirement` (`list`, `get`, `create`, `update`, `delete`, `link`, `unlink`, `coverage`, `export`), `var`, `tag`, `notification` (`create`, `update`, `delete`) |
| AI SRE | `incident list/get/timeline/assign/unassign/ack/resolve`, `sre triage/investigate/ask/brief/status`, `service list/get` |

Run `supercheck <command> --help` for options, or see the [command reference](https://supercheck.io/docs/cli/commands).

## CI/CD

Triggering a job needs `SUPERCHECK_TRIGGER_KEY`. Adding `--wait` also needs a CLI token in `SUPERCHECK_TOKEN` with access to read the job and its runs:

```bash
supercheck --json job trigger <job-id> --wait --timeout 600
```

A failed run exits nonzero. If waiting is interrupted, resume with `supercheck run wait <run-id>`; this never triggers a new run. See the [CI/CD guide](https://supercheck.io/docs/cli/ci-cd) for GitHub Actions, GitLab CI, and Docker.

## Output and exit codes

| Flag | Behavior |
| --- | --- |
| `--json` | Structured JSON. Lists stay plain arrays unless `--envelope` is set. Streaming commands and local runs emit NDJSON. Errors are JSON on stderr. |
| `--envelope` | With `--json`, wrap list results as `{ "data": [...], "pagination": {...} }`. |
| `--quiet` | Print only resource or run IDs and errors. `--json` takes precedence. |
| `--show-secrets` | Disable redaction of sensitive fields. Avoid in shared logs or transcripts. |
| `--wide`, `--no-color`, `--debug` | Untruncated tables, no ANSI colors (`NO_COLOR` also works), diagnostics. |

Credentials, webhook URLs, and credential headers are redacted from output by default.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | General error, or a run that failed |
| `2` | Authentication error |
| `3` | Configuration error, declined or unavailable confirmation (`ABORTED`, `CONFIRMATION_REQUIRED`) |
| `4` | Network or API error |
| `5` | Timeout |
| `130` | Interrupted (Ctrl+C) |

Write operations that need confirmation never proceed without it in non-interactive sessions. Review the plan, then pass `--force` explicitly.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPERCHECK_TOKEN` | Project-scoped CLI token |
| `SUPERCHECK_TRIGGER_KEY` | Job trigger key for `job trigger` |
| `SUPERCHECK_URL` | API URL for self-hosted instances; overrides the stored login URL |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | Proxy configuration |

`SUPERCHECK_TOKEN`, `SUPERCHECK_TRIGGER_KEY`, `SUPERCHECK_URL`, proxy settings (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, ...) and TLS settings (`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`, ...) are read only from the real environment or a stored login, never from a project `.env` file, so a cloned repository cannot choose your credential, where it is sent, or how the connection is protected. Export them in your shell or CI secret store. Commands that load `supercheck.config.ts` still execute it; do not run `deploy`, `pull` or `diff` in a repository you do not trust. `doctor`, `onboard`, `discover`, `link`, `plan`, `ci` and `agent` never run it (`doctor --fix` runs `npx playwright install` from the repository: use it only where you trust the repository).

Run `supercheck whoami` to see the active API URL and project.

## Use with AI agents

The CLI ships offline, versioned workflow guidance. `supercheck skills` prints an index and `supercheck skills <topic>` focused instructions. `supercheck agent install --target claude|cursor|codex|opencode|generic` (or `supercheck skills install`) writes the skill and never overwrites an existing file without `--force`. `supercheck onboard --json` reports the current onboarding state and the single next command, `supercheck discover --json` prints repository facts, `supercheck plan` shows the subscription state, `supercheck ci init --github` writes a workflow, and `supercheck deploy --verify` runs each created or updated browser test once in the cloud. `supercheck capabilities --json` reports what the installed CLI supports; `--online` also verifies the current API context, but does not prove every server feature or permission.

## Compatibility

- Requirements, status page deploys, and monitor tags need Supercheck Cloud or a self-hosted Supercheck 1.4.0 or later. On an older server the CLI stops with an upgrade hint before writing anything, with one exception: in a project with no existing monitor to probe, a tagged monitor is created before the missing monitor-tag API is detected. Check the created monitor's ID and `supercheck.state.json` after that error.
- Creating requirements by uploading a document (PDF, DOCX, Markdown, TXT) with AI is available in the dashboard only.
- AI SRE requires a configured AI provider on the server. Live connectors need explicit `--live-connectors` consent and permissions.
- `sre status` needs a Supercheck release that provides the investigation-status endpoint.
- Firefox and WebKit local execution are supported by configuration but have not yet been verified in release testing.

## Links

- [CLI documentation](https://supercheck.io/docs/cli/commands)
- [Changelog](https://github.com/supercheck-io/supercheck/blob/main/cli/CHANGELOG.md)
- [Report an issue](https://github.com/supercheck-io/supercheck/issues)
- [Contributing](https://github.com/supercheck-io/supercheck/blob/main/CONTRIBUTING.md) and [security policy](https://github.com/supercheck-io/supercheck/blob/main/SECURITY.md)
- [Release process](https://github.com/supercheck-io/supercheck/blob/main/cli/RELEASING.md)

## License

[Apache-2.0](https://github.com/supercheck-io/supercheck/blob/main/cli/LICENSE). See `NOTICE` for attributions.

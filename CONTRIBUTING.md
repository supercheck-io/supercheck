# Contributing to Supercheck

Thanks for helping. Keep changes small, tested, and documented.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md) and get help through [SUPPORT.md](SUPPORT.md).

## Before you start

- Discuss large features, new providers, database changes, or breaking behavior in [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions) or [Discord](https://discord.gg/UVe327CSbm) first.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Do not open a public issue.
- Search existing issues and pull requests before starting work.
- For anything larger than a small fix, open or comment on an issue so maintainers can confirm the approach before you invest time.

## Development setup

Requirements:

- **Node.js 20 or later.** Individual packages state their supported version in `engines` and CI; use the version required by the package you touch.
- **Docker Compose v2** for self-hosted deployment work.
- **Linux** (Ubuntu 22.04+, Debian 12+) for anything that exercises the K3s and gVisor execution sandbox. macOS and Windows can develop the app, worker, CLI, recorder, and docs, but cannot run the sandboxed execution stack.

Run `npm` commands from the package directory, not the repository root. Each package has its own `package-lock.json`; use `npm ci` for a clean, reproducible install.

## Workflow

1. Fork the repository and branch from `main`. Use a short, descriptive branch name such as `fix/cli-timeout` or `docs/deploy-sync`.
2. Keep the pull request focused: one problem, one approach.
3. Update tests and user-facing docs in the same PR.
4. Run the checks for the packages you touched.
5. Open a pull request using the template. State the problem, the approach, and the exact commands you ran.

Use the bug, feature, or docs issue forms for new reports. Pull requests follow [`.github/pull_request_template.md`](.github/pull_request_template.md).

## Commit and pull request conventions

- Write [Conventional Commits](https://www.conventionalcommits.org/) style messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`, or `perf:` followed by a short imperative summary.
- Keep commit titles concise and in the imperative mood ("add", not "added").
- Reference related issues in the PR description (for example, `Closes #123`).
- Pull requests are merged with **squash merge**, so the pull request title and description become the record on `main`. Keep the title in Conventional Commit format and update it if the scope changes.
- Keep the branch up to date with `main` before requesting review.

## Repository layout

| Path | What it is |
|------|------------|
| `app/` | Next.js UI and API |
| `worker/` | NestJS workers (tests, monitors, notifications) |
| `cli/` | `@supercheck/cli` and monitoring-as-code commands |
| `recorder/` | Apache-2.0 browser recorder extension built on Playwright CRX |
| `docs/` | User-facing documentation (Fumadocs) |
| `deploy/` | Docker Compose and self-hosted installation files |

The Supercheck CLI is published as [`@supercheck/cli`](https://www.npmjs.com/package/@supercheck/cli). File CLI and recorder bugs against this repository. CLI command docs live in `docs/content/docs/cli/`.

## Checks

### App

```bash
cd app
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build:webpack
```

### Worker

```bash
cd worker
npm ci
npx eslint "src/**/*.ts" --max-warnings 0
npx tsc --noEmit
npm test
npm run build
```

### Documentation

```bash
cd docs
npm ci
npm run build
```

### CLI

```bash
cd cli
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

### Recorder

```bash
cd recorder
npm ci
npm run build
npm run test:install
npm test
```

You do not need to run every package for a docs-only change.

## Requirements

- Validate untrusted input and enforce authorization on the server.
- Scope tenant data by organization and project where required.
- Never commit or log secrets, private URLs, production data, or tenant identifiers.
- Use the shared SSRF-safe helpers for user-configured outbound URLs.
- Preserve execution sandboxing, resource limits, and network isolation.
- Add a regression test for behavioral fixes.
- Update user-facing docs when behavior, setup, or CLI commands change.

Use disposable fixtures for browser and provider tests and remove them afterward. Do not commit generated coverage, Playwright artifacts, local databases, or `.DS_Store` files.

## Review and merge

- A maintainer review is required before merge.
- Required status checks must pass and the branch must be up to date before merge.
- Maintainers may ask you to split a large PR or add tests before it can land.
- If your change alters behavior, configuration, or user-facing docs, call it out in the PR description.

## License

The app, worker, CLI, and documentation are licensed under `AGPL-3.0-only`. The recorder remains under Apache-2.0 because it derives from Playwright CRX and Playwright; see `recorder/LICENSE` and `recorder/NOTICE`. By submitting a contribution, you certify that you have the right to submit it under the license of the files you change. All contributors must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

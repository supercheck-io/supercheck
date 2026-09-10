# Contributing to Supercheck

Thanks for helping. Keep changes small, tested, and documented.

## Before you start

- Discuss large features, new providers, database changes, or breaking behavior in [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions) or [Discord](https://discord.gg/UVe327CSbm) first.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Do not open a public issue.
- Search existing issues before filing a new one.

## Workflow

1. Fork the repository and branch from `main`.
2. Keep the pull request focused: one problem, one approach.
3. Update tests and user-facing docs in the same PR.
4. Run the checks for the packages you touched.
5. Open a pull request that states the problem, the approach, and the exact commands you ran.

Use the bug, feature, or docs issue templates. Pull requests should follow `.github/pull_request_template.md`.

## Repository layout

Run npm commands from the package directory, not the repository root.

| Path | What it is |
|------|------------|
| `app/` | Next.js UI and API |
| `worker/` | NestJS workers (tests, monitors, notifications) |
| `cli/` | `@supercheck/cli` and monitoring-as-code commands |
| `recorder/` | Apache-2.0 browser recorder extension built on Playwright CRX |
| `docs/` | User-facing documentation (Fumadocs) |
| `deploy/` | Docker Compose, K3s, and self-hosted install files |

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

## License

The app, worker, CLI, and documentation are licensed under `AGPL-3.0-only`. The recorder remains under Apache-2.0 because it derives from Playwright CRX and Playwright; see `recorder/LICENSE` and `recorder/NOTICE`. By submitting a contribution, you certify that you have the right to submit it under the license of the files you change. All contributors must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

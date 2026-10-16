# Contributing to Supercheck

Thanks for helping. Keep changes small, tested, and documented.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md) and get help through [SUPPORT.md](SUPPORT.md).

## Before you start

- Discuss large features, new providers, database changes, or breaking behavior in [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions) first.
- Report vulnerabilities privately through [SECURITY.md](SECURITY.md). Do not open a public issue.
- Search existing issues and pull requests before starting work.
- For anything larger than a small fix, open or comment on an issue so maintainers can confirm the approach before you invest time.

## Development setup

Requirements:

- **Node.js 20 or later.** Individual packages state their supported version in `engines` and CI; use the version required by the package you touch.
- **Docker Compose v2** for self-hosted deployment work.
- **Linux** (Ubuntu 22.04+, Debian 12+) for anything that exercises the K3s and gVisor execution sandbox. macOS and Windows can develop the app, worker, CLI, recorder, and docs, but cannot run the sandboxed execution stack.

Run `npm` commands from the package directory, not the repository root. Each package has its own `package-lock.json`; use `npm ci` for a clean, reproducible install.

### Run the app and worker from source against Compose infrastructure

For fast iteration, run the app and worker with `npm run dev` while PostgreSQL, Redis, and RustFS run in Docker Compose. The local Compose file publishes these services on loopback with public local development credentials. Use these credentials only for trusted local development.

Start the infrastructure from the repository root:

```bash
cd /path/to/supercheck
docker compose -f deploy/docker/docker-compose-local.yml up -d postgres redis rustfs
docker compose -f deploy/docker/docker-compose-local.yml stop app worker
```

Before starting either package, copy its `.env.example` to `.env` only if `.env` does not already exist, then configure it for the local Compose services. Set matching `DATABASE_URL` and S3 settings in both packages. The database URL must use the Compose PostgreSQL credentials, and the S3 endpoint, bucket, region, access key, and secret key must match RustFS. Preserve existing `.env` files and edit them as needed. The local RustFS development keys are `localdevaccesskey` / `localdevsecretkey0123456789abcdef`.

The app uses `REDIS_URL` and also reads `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` for its shared Redis clients. The worker uses `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD`. Match these settings to the Compose Redis service. If a local service already uses a default port, set `DB_HOST_PORT`, `REDIS_HOST_PORT`, or `RUSTFS_HOST_PORT` in `deploy/docker/.env` and update the corresponding package settings (`DATABASE_URL`, Redis settings, or `S3_ENDPOINT`).

In a separate terminal for the app, run from the repository root:

```bash
cd /path/to/supercheck/app
test -f .env || cp .env.example .env
npm ci
npm run db:migrate
npm run dev
```

The app is available at `http://localhost:3000`. In another terminal for the worker, run from the repository root:

```bash
cd /path/to/supercheck/worker
test -f .env || cp .env.example .env
npm ci
npm run dev
```

The worker health endpoint is `http://localhost:8000/health/ready`. To switch back, stop both dev servers with Ctrl+C, then start the containerized app and worker from `deploy/docker`:

```bash
cd /path/to/supercheck/deploy/docker
docker compose -f docker-compose-local.yml up -d app worker
```

Worker test runs still execute as Kubernetes Jobs. For a local cluster, use a namespace-scoped worker kubeconfig through `KUBECONFIG`. OrbStack has no gVisor `RuntimeClass`; set `EXECUTION_RUNTIME_CLASS_NAME=none` to run without the sandbox, and use only local, trusted targets.

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

Worker receipt tests run with embedded PostgreSQL locally. PR validation and
Release Certification also run them against disposable PostgreSQL 18, including
concurrent settlement tests. No local database setup is required.

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

### Deploy / self-hosted

```bash
./deploy/docker/validate.sh
```

`validate.sh` shell-checks the deploy scripts and interpolates every Compose file with placeholder values, so it catches broken `${VAR:?}` interpolation and malformed YAML without starting containers. If [ShellCheck](https://www.shellcheck.net/) is installed, also run:

```bash
shellcheck deploy/docker/*.sh .github/scripts/*.sh app/scripts/*.sh
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
- Internal PRs also receive an advisory [automatic AI review](.github/PR_REVIEW.md) with inline findings and suggestions.
- Required status checks must pass and the branch must be up to date before merge.
- Maintainers may ask you to split a large PR or add tests before it can land.
- If your change alters behavior, configuration, or user-facing docs, call it out in the PR description.

## License

The app, worker (including Private Agent mode), deployment assets, and documentation are `AGPL-3.0-only`. The CLI and recorder are Apache-2.0; retain third-party licenses, notices, and upstream headers.

Read the [contributor license agreement](CLA.md); maintainers will ask you to sign it, or to give equivalent written acceptance, before your contribution is merged. You keep ownership and grant the maintainer rights to distribute your contribution under open-source or commercial terms, with a patent grant. The agreement does not replace the license of the files you change. Every human contributor must be covered, including co-authors and anyone contributing through an employer. Maintainers follow the [CLA setup and verification runbook](.github/CLA_SETUP.md). All contributors must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

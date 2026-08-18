# Contributing to Supercheck

We welcome focused bug fixes, documentation improvements, and features. Discuss
large features, new providers, database changes, or breaking behavior before
implementation. Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Workflow

1. Fork the repository and branch from `main`.
2. Keep the pull request focused and update tests and documentation together.
3. Run the relevant package checks below.
4. Open a pull request with the problem, approach, and exact test results.

Run npm commands from `app/`, `worker/`, or `docs/`, not the repository root.

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

## Requirements

- Validate untrusted input and enforce authorization on the server.
- Scope tenant data by organization and project where required.
- Never commit or log secrets, private URLs, production data, or identifiers.
- Use the shared SSRF-safe helpers for user-configured outbound URLs.
- Preserve execution sandboxing, resource limits, and network isolation.
- Add a regression test for behavioral fixes and update affected documentation.

Use disposable fixtures for browser/provider tests and remove them afterward.
Generated coverage, Playwright artifacts, local databases, and `.DS_Store` files
must not be committed.

Supercheck is licensed under `AGPL-3.0-only`. By submitting a contribution, you
certify that you have the right to submit it under that license. All contributors
must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

For questions, use [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions)
or [Discord](https://discord.gg/UVe327CSbm).

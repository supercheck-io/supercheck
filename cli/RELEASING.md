# Releasing the Supercheck CLI

Version **0.3.1** is prepared with the Apache-2.0 CLI license; verify the currently published version against npm. Publish manually from a clean checkout after the release PR merges and CI passes. The README diagram points to an image on `main`, so merge it before publishing.

## Validate and build

From the `cli` directory:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
node -p "require('./package.json').version"
npm view @supercheck/cli versions --json
```

Confirm the package version is 0.3.1 and that version is absent from npm. Inspect the package contents: executable, type exports, README, architecture image, Apache-2.0 LICENSE, and NOTICE. Verify package.json and the lockfile both declare Apache-2.0. Future releases must update both package versions in `package-lock.json`, `package.json`, and the changelog.

Exercise the packed installation, including offline `skills` guidance and account-free local execution. Before releasing the agent workflow changes, deploy a test, dependent job, and synthetic monitor against an isolated real API, then verify an identical second deploy sends zero writes. Preserve `supercheck.state.json` between deploys. See [agent workflow review notes](./AGENT_FIRST_REVIEW.md) for completed checks and remaining acceptance gates; mock API tests do not replace this real-server check.

## Authenticate and publish manually

Use an npm account with package-write access:

```bash
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish --dry-run --access public --tag latest --registry=https://registry.npmjs.org
npm publish --access public --tag latest --registry=https://registry.npmjs.org
```

Complete the browser/2FA prompts. If npm returns `EOTP`, retry publication with `--otp=YOUR_CURRENT_OTP`. If an environment token overrides interactive login, remove that token from the publishing session. Never commit credentials or an authenticated `.npmrc`.

npm versions cannot be overwritten. An authentication failure does not consume a version, so check registry state before retrying. Manual publication does not provide GitHub Actions provenance.

## Verify publication

```bash
npm view @supercheck/cli@0.3.1 version license dist --json
npm view @supercheck/cli dist-tags --json
npm install -g @supercheck/cli@0.3.1
supercheck --version
supercheck sre --help
```

Confirm `latest` and the installed CLI report 0.3.1. Check the npm README image after publication. Date the CLI changelog entry and publish release notes identifying the source commit and the Apache-2.0 license change. Matching app/worker deployment is required for investigation status and the console/k6 fixes.

## Optional GitHub publishing

`.github/workflows/cli-publish.yml` supports trusted publishing or `NPM_TOKEN` with provenance. Pushing a `cli-v*` tag triggers npm publication automatically. For a manual release, do not push such a tag unless that workflow has been disabled or changed to avoid duplicate publication.

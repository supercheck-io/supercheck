# Releasing the Supercheck CLI

Version **0.3.0** is prepared; **0.2.1** is currently published. Publish manually from a clean checkout after the release PR merges and CI passes. The README diagram points to an image on `main`, so merge it before publishing.

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

Confirm the package version is 0.3.0 and that version is absent from npm. Inspect the package contents: executable, type exports, README, architecture image, and license. Future releases must update both package versions in `package-lock.json`, `package.json`, and the changelog.

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
npm view @supercheck/cli@0.3.0 version dist --json
npm view @supercheck/cli dist-tags --json
npm install -g @supercheck/cli@0.3.0
supercheck --version
supercheck sre --help
```

Confirm `latest` and the installed CLI report 0.3.0. Check the npm README image after publication. Date the CLI changelog entry and publish release notes identifying the source commit and the new `--delete` opt-in. Matching app/worker deployment is required for investigation status and the console/k6 fixes.

## Optional GitHub publishing

`.github/workflows/cli-publish.yml` supports trusted publishing or `NPM_TOKEN` with provenance. Pushing a `cli-v*` tag triggers npm publication automatically. For a manual release, do not push such a tag unless that workflow has been disabled or changed to avoid duplicate publication.

# Releasing the Supercheck CLI

The reviewed patch version is **0.2.1**. Confirm registry state before publishing because npm versions cannot be overwritten. Failed authentication does not consume a version.

## Validate the reviewed source

After merging PR #340, use an up-to-date checkout of `main`. To validate the unmerged candidate, check out `fix/cli-aisre-defaults-and-release` instead. Work in the `cli` directory:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
node -p "require('./package.json').version"
npm view @supercheck/cli dist-tags --json
npm view @supercheck/cli versions --json
```

The local package version must be 0.2.1, and 0.2.1 must be absent from the registry. Inspect the packed README, executable, type exports, and license before publishing. Never put npm tokens into the repository or a committed `.npmrc`.

## Preferred: publish with GitHub provenance

Use `.github/workflows/cli-publish.yml`. It validates before publishing, selects `latest` for stable versions, and signs provenance. Configure npm trusted publishing for repository `supercheck-io/supercheck`, workflow `cli-publish.yml`, or supply the encrypted repository secret `NPM_TOKEN` with package-write access and allowed 2FA bypass. npm package settings must also permit bypass-2FA tokens.

For this corrected 0.2.1 candidate, the existing `cli-v0.2.1` tag identifies the earlier candidate. Do not rerun that old tag build to publish the corrected README. Dispatch the workflow from the reviewed release branch, or `main` after merging:

```bash
gh workflow run cli-publish.yml --repo supercheck-io/supercheck --ref fix/cli-aisre-defaults-and-release -f dry-run=false
```

For future releases, create `cli-v<package-version>` at the exact validated commit. Do not move tags for versions already published to npm.

## Manual publication when CI authentication is blocked

Use an npm account with write access to `@supercheck/cli`. Interactive login supports account 2FA without storing a token in source:

```bash
npm login --registry=https://registry.npmjs.org
npm whoami
npm publish --access public --tag latest
```

If npm returns `EOTP`, retry with a current authenticator code:

```bash
npm publish --access public --tag latest --otp=YOUR_CURRENT_OTP
```

Replace the placeholder with the code when running the command. If an existing environment token overrides your interactive login, remove that token from the publishing session first. Local publication does not provide GitHub Actions provenance; use the workflow when provenance is required. Do not bump the version solely because an authentication attempt failed.

## Verify publication

```bash
npm view @supercheck/cli@0.2.1 version dist --json
npm view @supercheck/cli dist-tags --json
npm install -g @supercheck/cli@0.2.1
supercheck --version
supercheck sre --help
```

Verify `latest` is 0.2.1 and the installed CLI reports 0.2.1. Update GitHub release notes with the actual published source commit, remove the pending-publication notice only after registry verification, and record whether provenance is present.

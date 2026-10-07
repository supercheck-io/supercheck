# Releasing the Supercheck CLI

CLI **0.2.1** is published; **0.3.0** is prepared for the next release. For future releases, update `cli/package.json`, the root package version in `cli/package-lock.json`, the README, and the changelog. Confirm registry state before publishing because npm versions cannot be overwritten. CLI 0.3.0 changes the default deploy/diff behavior to preserve absent remote resources; document the explicit `--delete` opt-in in release notes. Failed authentication does not consume a version.

## Validate the reviewed source

Use an up-to-date checkout of the reviewed release commit, normally `main` after the release PR merges. Work in the `cli` directory:

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

The local package version must match the planned release and be absent from the registry. The commands below use 0.3.0 as the pending release example. Do not republish an existing version. Inspect the packed README, executable, type exports, and license before publishing. Never put npm tokens into the repository or a committed `.npmrc`.

## Preferred: publish with GitHub provenance

Use `.github/workflows/cli-publish.yml`. It validates before publishing, selects `latest` for stable versions, and signs provenance. Configure npm trusted publishing for repository `supercheck-io/supercheck`, workflow `cli-publish.yml` (the publish job installs npm 11 for OIDC support), or supply the encrypted repository secret `NPM_TOKEN` with package-write access and allowed 2FA bypass. npm package settings must also permit bypass-2FA tokens.

For a reviewed, unpublished version on `main`:

```bash
gh workflow run cli-publish.yml --repo supercheck-io/supercheck --ref main -f dry-run=false
```

For tag-triggered releases, create `cli-v<package-version>` at the exact validated commit. Do not move tags for versions already published to npm.

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
npm view @supercheck/cli@0.3.0 version dist --json
npm view @supercheck/cli dist-tags --json
npm install -g @supercheck/cli@0.3.0
supercheck --version
supercheck sre --help
```

After successful publication, verify `latest` is 0.3.0 and the installed CLI reports 0.3.0. Deploy matching app/worker images before accepting `sre status`, Playwright console streaming, and short k6 report behavior in production. Update GitHub release notes with the actual published source commit, remove the pending-publication notice only after registry verification, and record whether provenance is present.

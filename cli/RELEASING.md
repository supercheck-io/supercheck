# Releasing the Supercheck CLI

CLI releases are published to npm by `.github/workflows/cli-publish.yml` using npm trusted publishing (OIDC). Maintainers prepare and merge the version change; a maintainer creates and pushes the signed release tag from the merged commit. Automation and coding agents must not create tags or releases, or dispatch publish workflows; see [the release policy](../docs/releasing.md).

## One-time npm setup

In the npm settings for `@supercheck/cli`, configure a trusted publisher with:

- Provider: GitHub Actions
- Organization: `supercheck-io`
- Repository: `supercheck`
- Workflow filename: `cli-publish.yml`
- Environment: none

Allow direct `npm publish` for this trusted publisher. See [npm's trusted publishing setup](https://docs.npmjs.com/trusted-publishers/).

The workflow uses GitHub-hosted Node.js 24, pins npm to 11.21.1, and requests the `id-token: write` permission needed for OIDC. It does not use `NPM_TOKEN`. After a successful OIDC publication is confirmed, remove the old `NPM_TOKEN` publishing secret and restrict any remaining npm tokens to the minimum needed. Complete and verify this npm-side setup before the first release; this repository cannot prove that the external publisher configuration is active.

## Prepare and validate a release

Choose a new version and add its dated notes to [CHANGELOG.md](./CHANGELOG.md). From `cli/`, update `package.json` and `package-lock.json` together:

```bash
npm version <version> --no-git-tag-version
```

Open a PR with the version and changelog update, then merge it after required CI passes. The tag must point at that exact merged commit. The release workflow validates lint, types, tests, build, licenses and notices, and package contents before publishing.

Keep the local release gates as well:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Inspect the tarball for the executable, type exports, README, architecture image, Apache-2.0 `LICENSE`, and `NOTICE`. Exercise a packed installation, including offline skills guidance and account-free local execution. Before releasing agent workflow changes, deploy a test, dependent job, and synthetic monitor against an isolated real API, then verify that an identical second deploy sends zero writes. Preserve `supercheck.state.json` between deploys. Mock API tests do not replace this real-server check.

## Publish from GitHub

After the version PR has merged and npm trusted publishing is configured, a maintainer creates and pushes the signed, annotated tag for that exact commit:

```bash
git tag -s cli-v<version> -m "cli-v<version>" <merged-commit>
git cat-file -t refs/tags/cli-v<version>  # must print: tag
git verify-tag refs/tags/cli-v<version>  # must report a valid signature
git rev-parse 'refs/tags/cli-v<version>^{commit}'
git push origin cli-v<version>
```

The signer must be listed in `.github/release-allowed-signers` on `main`. The workflow requires the signed tag to match the package version (`cli-v<version>`) and the tag's commit to match the workflow's checked-out commit. These checks apply to every publishing run. A manual workflow dispatch defaults to a dry run; selecting a real publish still requires a valid matching signed tag. Stable versions publish under `latest`; versions containing a hyphen publish under `next`. After a successful publish, the workflow creates a GitHub Release for the tag (not marked as the repository's latest release), linking to the npm version. npm packages never appear in GitHub's Packages sidebar, which lists only GitHub's own registry; the npm page links back to this repository through `repository` in `package.json` and the provenance attestation.

## Verify the release

After the workflow succeeds, confirm the published version, provenance, and dist-tag on npm, then install the released version and check the CLI:

```bash
npm view @supercheck/cli@<version> version license dist --json
npm view @supercheck/cli dist-tags --json
npm install -g @supercheck/cli@<version>
supercheck --version
supercheck sre --help
```

Confirm the expected version and `latest` or `next` tag, inspect npm's provenance for the GitHub Actions run, and check the installed version. Never reuse a published version. The next release must bump both package version files and add dated changelog notes before its tag is created.

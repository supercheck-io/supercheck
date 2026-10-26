# Releasing

Releases are cut by a maintainer only. Automation and coding agents must not
create, move, or delete git tags or GitHub releases, and must not dispatch the
publish workflows (`build-multiarch.yml`, `cli-publish.yml`,
`recorder-publish.yml`).

## Release tags

- Release tags are annotated and signed with a key listed in
  `.github/release-allowed-signers` on `main`.
- Each tag-triggered publish workflow runs a "Require signed annotated release
  tag" step first. Lightweight, unsigned, or unlisted-key tags fail there, and
  every later job in that workflow is blocked.
- The signers file is read from `main`, not from the tagged commit, so a tag
  cannot add its own key.
- Manual `cli-publish.yml` and `recorder-publish.yml` runs only proceed as
  dry runs unless they run on a signed tag.

## GitHub releases

`cli-publish.yml` and `recorder-publish.yml` create the GitHub Release for their
tag after a successful publish. Pushing the signed tag is the only manual step;
do not create releases by hand for those tags.

## Creating a release tag

```bash
git tag -s v<version> -m "v<version>" <commit>
git push origin v<version>
```

Check the tag before pushing:

```bash
git cat-file -t refs/tags/v<version>   # must print: tag
git verify-tag refs/tags/v<version>    # must print: Good "git" signature
```

## App and worker releases

Stable app and worker releases use `v<version>` tags; `v<version>-canary.<n>`
tags are prereleases built from `main`.

1. In one PR, set the version in every location the "Require stable tag to
   match all version locations" step checks: `app/package.json`,
   `worker/package.json` (run `npm version <version> --no-git-tag-version` in
   each so the lockfiles follow), and every `SUPERCHECK_VERSION` default in
   `deploy/docker/*.yml`. Update `SUPERCHECK_VERSION_DEFAULT` in
   `deploy/docker/install.sh`, the install and upgrade examples in
   `deploy/docker/*.md` and `docs/content/docs/app/deployment/`, and date the
   `CHANGELOG.md` section. Run `./deploy/docker/validate.sh`.
2. Merge the PR. Docs deploy on merge, so tag right away: until the images are
   published, the documented version cannot be pulled.
3. Create and push the signed tag on the merged commit (see "Creating a release
   tag"). `build-multiarch.yml` certifies the release, pushes the images
   (`latest` only for stable tags) and deploys the demo after approval.
4. After the images are published, create the GitHub Release for the tag with
   the changelog section as its notes. No workflow creates releases for `v*`
   tags.

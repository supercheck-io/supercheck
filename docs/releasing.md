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

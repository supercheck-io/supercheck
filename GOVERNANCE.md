# Governance

This document describes how the Supercheck project is maintained. It is intentionally lightweight and evolves with the community.

## Roles

- **Maintainers** — review and merge pull requests, manage releases, triage issues, and set technical direction. Maintainers are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
- **Contributors** — anyone who opens an issue, reviews a pull request, or submits a change. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Decision making

- Small changes (bug fixes, docs, tests, dependency updates) are decided through pull request review by a maintainer.
- Large or breaking changes are discussed first in [GitHub Discussions](https://github.com/supercheck-io/supercheck/discussions) or an issue so maintainers can confirm the approach.
- Maintainers aim for consensus. When consensus is not reached, the maintainers make the final call and document the reasoning in the relevant issue or pull request.
- Security decisions follow [SECURITY.md](SECURITY.md).

## Pull requests and reviews

- A maintainer review is required before merge. CODEOWNERS routes review requests automatically.
- Pull requests are squashed on merge, and Conventional Commit style titles are used for the resulting history. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Maintainers may close stale or out-of-scope pull requests with an explanation.

## Releases

- Supercheck follows [Semantic Versioning](https://semver.org/). Release notes live in [CHANGELOG.md](CHANGELOG.md).
- The `@supercheck/cli` package is versioned and released independently; see [`cli/CHANGELOG.md`](cli/CHANGELOG.md).
- Release tags and changelog entries are the source of truth for what shipped.

## Community

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.
- Get help through [SUPPORT.md](SUPPORT.md).

## Changes to this document

Propose changes to this document through a pull request. Maintainers review governance changes with extra care and aim to give the community time to comment before merging.

# Changelog

## Unreleased

- Add `job update <id> --tests <ids...>` to replace the tests in an existing job, including dry-run support.

- Publish deployment locks only after their owner information is written, so an interrupted lock creation cannot leave an empty lock that blocks later deploys.

## 0.3.2 - 2026-10-18

- Fix CLI k6 detection when identical script content is parsed repeatedly, including duplicate scripts in one command.
- Preserve syntax diagnostics for invalid k6 scripts and remove duplicated request-size error text.
- Server-side: k6 validation now rejects scripts with no default export or `scenarios` entry point, while dynamic scenario options still pass. Takes effect once your Supercheck instance is upgraded.
- Publish CLI releases from GitHub Actions using npm trusted publishing (OIDC).

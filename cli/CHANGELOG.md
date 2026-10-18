# Changelog

## 0.3.2 - 2026-10-18

- Fix CLI k6 detection when identical script content is parsed repeatedly, including duplicate scripts in one command.
- Preserve syntax diagnostics for invalid k6 scripts and remove duplicated request-size error text.
- Validate k6 entry points (default export or scenarios) while preserving dynamic scenario options.
- Publish CLI releases from GitHub Actions using npm trusted publishing (OIDC).

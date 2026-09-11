# Changelog

All notable changes to `@supercheck/cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-11

### Added

- AI SRE incident commands for listing, inspecting, resolving, and viewing timelines.
- AI triage, asynchronous deep-investigation, streaming Copilot chat, and streaming evidence-brief commands.
- Read-only service catalog, health, and dependency commands.
- `--payload` and `--data` aliases for notification provider JSON; `--config` remains supported for compatibility.

### Security

- AI SRE API routes now support project-scoped CLI bearer tokens without weakening existing RBAC or tenant boundaries.
- Stream clients enforce idle timeouts, cancellation, and a 1 MiB per-event safety limit.
- Incident resolution requires an explicit confirmation unless `--force` is supplied and records both timeline and audit events.

## [0.1.4] - 2026-09-10

### Fixed

- `supercheck deploy` stores UTF-8 test source (Base64-encoded for the API) and strips `sourceMappingURL` comments and trailing binary sourcemap bytes. Monitor execution no longer sees compiled JavaScript with appended sourcemaps.
- `supercheck diff` continues to detect webhook `bodyTemplate` drift on notification providers.

## [0.1.3] - 2026-06-26

### Fixed

- Notification provider round-trip safety:
  - `supercheck pull` now strips masked secret fields (e.g. webhook URLs, headers, tokens) from notification provider configs instead of writing placeholder values to disk.
  - `supercheck diff` remains stable after a pull because `config.name` is normalized on both local and remote configs.
  - `supercheck deploy` preserves existing secret values for sensitive fields omitted from the local config, so non-secret edits like `bodyTemplate` can be deployed without overwriting real webhook credentials.

## [0.1.2] - Previous release

- Initial tracked release of `@supercheck/cli`.

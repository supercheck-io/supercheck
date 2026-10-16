# Agent-first CLI remediation

This records the implementation following the CLI source review and the supplied Checkly REA comparison. Competitor behavior is attributed to that report; it is not a dependency of this implementation.

## Compatibility decisions

- Authentication failures retain exit 2. Non-interactive confirmation refuses with exit 3, `CONFIRMATION_REQUIRED`, structured changes/context, and argument-array remediation. Existing `--force` flags remain supported; upgrade retains `--yes`.
- Existing JSON list arrays remain unchanged. `--json --envelope` opts into pagination metadata. Finite commands return JSON; streaming and local-run commands use NDJSON.
- Names do not establish remote ownership. A target-bound `supercheck.state.json` records created IDs atomically; existing resources require explicit IDs or pull. Keep the state file with the project and share it with CI. The adjacent deployment lock is temporary.
- Ordinary cloud-validated local execution remains available. Explicit `--offline` enables account-free local execution without implying cloud acceptance.

## Fixes delivered

| Review item | Result |
| --- | --- |
| Wrong-target operations | Verify configured organization/project against actual token context before sync and direct resource operations. |
| F1/F10 confirmations | Shared non-TTY/JSON refusal; cancellation is nonzero; destroy uses the same structured refusal contract. |
| F2/F8 machine output | Structured diff/deploy plans, created IDs, partial results, dry-run payloads, validation, pull, and init outcomes. Delete commands return resource IDs. |
| F3 repeat creates | Persist generated IDs without rewriting source or automatically adopting names. Follow replacement-ID chains and reject cycles/ambiguous local identities. |
| F4 dependencies | Create providers/tests before dependents, resolve job/synthetic-monitor references, and stop after an apply failure. |
| F5 title drift | Preserve source test paths during deploy and strip UUID suffixes from inferred titles. Pull retains managed paths and backs up runner-type migrations. |
| F6 configuration | Reject unknown typed fields while retaining extensible provider/config maps. Reject unsupported monitor/job tag assignments. |
| F7 authentication | Token-free login returns an actionable nonzero error; environment tokens avoid an interactive login step. |
| F9 edited files | Back up changed config/scripts before pull replacement; report written files, backups, and partial errors. Pull remains remote-to-local replacement, not a merge. |
| F11 pagination | Bare-array endpoints are intentional API contracts; retain their behavior. Paginated lists can expose completeness through the opt-in envelope. |
| F12 response parsing | Successful malformed JSON is a protocol error and is not retried as a transport failure. |
| F13 partial inventory | Fail closed on incomplete destroy inventory; avoid duplicate fetch diagnostics. |
| F14 local output | Capture bounded runner output as NDJSON with exit codes/truncation and native JSON reports where available. |
| F15 secrets | Redact known credential fields and credential URLs in ordinary output, plans, errors, and diagnostics; `--show-secrets` deliberately opts in. Arbitrary secret text in user scripts cannot be identified reliably. |
| Run prerequisites/streams | Validate wait inputs before triggering, preserve accepted run IDs on observation failure, add resumable bounded waiting, and require terminal stream completion. |

## Agent workflows delivered

- Offline, versioned `skills` guidance and non-overwriting `skills install` pointer.
- `schema config` inspects typed configuration without executing project code; `capabilities` describes installed workflows and optionally verifies server context. Server feature support remains unknown unless separately established.
- Account-free local test/job execution, configured browser selection, and explicit application Playwright configuration. Local readiness and credential presence are separate diagnostics.
- Direct deployed-test execution and waiting on existing runs, including available report/error evidence from the existing run API.

## Follow-ups and release gates

Device OAuth, scoped workload identities, saved deployment plans, generic API pass-through/query engines, Markdown output, a full-screen TUI, and MCP are deferred. They need separate contracts or demonstrated demand. No browser login or implicit approval is introduced.

The regression suite covers real CLI entrypoint behavior using a synthetic API, plus focused state, redaction, wait, local-output, and dependency checks. Package verification must use a fresh build and packed installation. Hosted CI and a real isolated cloud test/job/monitor deploy followed by a zero-write second deploy remain release gates; mock acceptance does not establish server compatibility.

Initial local validation passed 351 tests in 29 suites, typecheck, lint, build, package inspection/installation, and 25 process scenarios against the packed CLI. Account-free Playwright assertions, intentional failure reporting, k6 execution, and a real Chromium page through an explicit application Playwright config passed with CLI cloud requests disabled. Firefox/WebKit execution was not exercised. Initial repository-wide line coverage was 46.55%; this is not a claim of complete regression coverage.

## Review follow-up

The independent review report and PR bot findings were checked against source and CLI behavior. Follow-up fixes cover Discord/Teams/webhook credentials (including whole config header maps), individual human-mode pull errors, diagnostic recovery from broken config, explicit missing-file errors for offline config commands, transient deployment aliases and renamed ownership, resumable wait-deadline failures, the print help text, and unreachable confirmation branches. Interactive refusal or EOF is `ABORTED` with exit 3; confirmation succeeds by returning normally.

Follow-up validation passed 362 tests in 29 suites, typecheck, lint, build, and all 31 process scenarios against a freshly packed installation. Diagnostic tests cover dotenv-only tokens and exported-token precedence without executing broken project configuration. The documentation production build and internal drift checker also passed. Measured repository-wide line coverage was 47.21%; hosted CI and real isolated cloud acceptance remain separate gates.

The suggested trigger-permission regression is not present in the current API: both `GET /api/jobs/[id]` and `GET /api/runs/[runId]` require `job:view`. Keep the job preflight; a context-only probe would not establish permission to read run results. Server authorization remains authoritative.

Backup pruning remains manual to avoid deleting recovery data. Local output remains bounded, with an explicit truncation flag; native report/artifact details are available when the report fits. Schema description remains tied to the installed Zod 3 API and must be revalidated during a major Zod upgrade. These optional enhancements do not require a new output contract in this fix.

A new npm CLI release is required for installed users to receive these changes. The repository currently prepares 0.3.1; confirm that version is unpublished before using it, otherwise select the next version and update both package manifests and changelog. Follow `RELEASING.md` after merge and CI. This change does not publish a package, push release tags, or deploy a server.

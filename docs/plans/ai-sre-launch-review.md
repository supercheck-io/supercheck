# AI SRE launch review

Goal: production-readiness review of AI SRE (pipeline, connectors, private agents, UI/UX, CLI, docs, Compose).

## Done (verified)

CLI (`cd cli && npm run typecheck && npm run lint && npm test` pass, 281 tests)
- `sre triage` timeout 30s -> 90s; SRE POSTs use `retries: 0`; 429 error reports `Retry-After`.
- SSE: sub-path base URL preserved, `ApiRequestError` keeps status/details, truncated streams exit 4, final unterminated frame flushed.
- `incident resolve`: fails (exit 3) non-interactively without `--force`; declined prompt exits 1; reports `alreadyResolved`.
- `--idle-timeout` validated; incident numbers > 2^31-1 rejected locally; `service dependencies` labels corrected.

Private Agent API
- `jobs/result`: guarded updates reject conflicting results; authenticated matching terminal replays are acknowledged without overwriting the saved result. The runner retries a lost acknowledgement without submitting a false failure.
- `jobs/lease`: expired credentials are never decrypted or delivered; the job fails with `connector_credential_expired` and the tool tells operators to re-authenticate. Regression tests cover this path, result replay, placeholder keys, direct triage conflicts and lost incident-update races.
- `result`, `heartbeat`, `registration/exchange`: malformed JSON -> 400 (was 500).

Config / secrets
- `.env.example` (app, worker) documented unused `VARIABLES_ENCRYPTION_KEY`/`CREDENTIAL_ENCRYPTION_KEY`; code reads `SECRET_ENCRYPTION_KEY`. Fixed.
- Compose (`docker-compose.yml`, `-local`, `-external`) no longer default `SECRET_ENCRYPTION_KEY` to a public placeholder; they fail with a clear message.
- `secret-crypto.ts` (app + worker) rejects `CHANGE_THIS`-style placeholder keys.
- Private-agent service: image HTTP healthcheck disabled (agent mode serves no HTTP).

Follow-up validation: full app/worker and CLI suites, type checks, lint and builds passed in isolated worktrees. Compose configuration, OpenAPI, diagram and docs-build checks passed. Independent source review found no remaining blockers in the fixes.

Reviewed, no change needed: registration exchange (single-use, constant-time, TTL), connector SSRF (DNS pinning, no redirects, 10 MiB cap).

## Open

- [ ] Server: tell the client when `useLiveConnectors` is dropped for users without connector permission (CLI `--live-connectors` silently downgraded).
- [ ] Config: review `BETTER_AUTH_SECRET` placeholder handling.
- [ ] `docker-compose-aisre-lab.yml` uses `:latest` + `admin/admin` (127.0.0.1 only) - pin or document as lab-only.
- [ ] Complete the credential-vault/query-injection deep dive and remaining connector/Copilot documentation review.
- [ ] Manual Compose acceptance: start with/without `SECRET_ENCRYPTION_KEY`, register a Private Agent, and rotate its token.

## Note
The working tree also holds unrelated uncommitted queue/location/monitor changes (app `queue.ts`, `location-service.ts`, scheduler; worker k6/monitor/redis; some docs). They are not part of this review; do not mix them into AI SRE commits.

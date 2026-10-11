# AI SRE launch review

Goal: production-readiness review of AI SRE (pipeline, connectors, private agents, UI/UX, CLI, docs, Compose).
Reviewers hit the session limit when run in parallel; run them one at a time.

## Done (verified)

CLI (`cd cli && npm run typecheck && npm run lint && npm test` pass, 281 tests)
- `sre triage` timeout 30s -> 90s; SRE POSTs use `retries: 0`; 429 error reports `Retry-After`.
- SSE: sub-path base URL preserved, `ApiRequestError` keeps status/details, truncated streams exit 4, final unterminated frame flushed.
- `incident resolve`: fails (exit 3) non-interactively without `--force`; declined prompt exits 1; reports `alreadyResolved`.
- `--idle-timeout` validated; incident numbers > 2^31-1 rejected locally; `service dependencies` labels corrected.

Private agent API (app tsc clean, 10 tests pass)
- `jobs/result`: UPDATE now re-asserts lease token + status and returns 409 on replay/concurrent post.
- `jobs/lease`: expired connector credential is never delivered; job fails with `connector_credential_expired`.
- `result`, `heartbeat`, `registration/exchange`: malformed JSON -> 400 (was 500).

Config / secrets
- `.env.example` (app, worker) documented unused `VARIABLES_ENCRYPTION_KEY`/`CREDENTIAL_ENCRYPTION_KEY`; code reads `SECRET_ENCRYPTION_KEY`. Fixed.
- Compose (`docker-compose.yml`, `-local`, `-external`) no longer default `SECRET_ENCRYPTION_KEY` to a public placeholder; they fail with a clear message.
- `secret-crypto.ts` (app + worker) rejects `CHANGE_THIS`-style placeholder keys.
- Private-agent service: image HTTP healthcheck disabled (agent mode serves no HTTP).

Reviewed, no change needed: registration exchange (single-use, constant-time, TTL), connector SSRF (DNS pinning, no redirects, 10 MiB cap).

## Open

- [ ] Server: tell the client when `useLiveConnectors` is dropped for users without connector permission (CLI `--live-connectors` silently downgraded).
- [ ] OpenAPI: add `GET /api/sre/runs/{id}` (+ triage/investigate/integrations/private-agents/diagnostic-recipes/onboarding if public) to `app/public/openapi.json` and `docs/public/openapi/openapi.yaml`; SSE event vocabulary for chat/brief.
- [ ] `cli/README.md`: add `incident resolve`, `service dependencies`; docs say CLI is read/triage/resolve only for SRE.
- [ ] Docs: `self-hosted.mdx` AI SRE section must mention `SECRET_ENCRYPTION_KEY` (app and workers must share it); fix BETTER_AUTH_SECRET placeholder handling similarly.
- [ ] Private agent runner: refuse non-HTTPS `SUPERCHECK_API_URL` unless host is private/loopback (bearer token over cleartext).
- [ ] `docker-compose-aisre-lab.yml` uses `:latest` + `admin/admin` (127.0.0.1 only) - pin or document as lab-only.
- [ ] NOT YET REVIEWED: alert->incident pipeline (dedup/race/RBAC), UI/UX (components/sre/**), credential vault + query injection + prompt-injection from connector output, worker `private-agent-runner.ts`, `docs/content` connector/copilot/incident pages.
- [ ] Final: code-reviewer + security-reviewer on full diff; app (`npx next typegen && npx tsc --noEmit && npm run lint && npm test`), worker (`npx tsc --noEmit && npm run lint:check && npm test`).

## Note
The working tree also holds unrelated uncommitted queue/location/monitor changes (app `queue.ts`, `location-service.ts`, scheduler; worker k6/monitor/redis; some docs). They are not part of this review; do not mix them into AI SRE commits.

# SRE Eval Gate

The SRE eval suite is a production safety gate for SuperCheck's read-only AI SRE agents.

## Why GitHub Actions

The `.github/workflows/sre-eval.yml` workflow is not required for local development or runtime behavior. It exists to prevent agent regressions from merging unnoticed. SRE agent changes can affect incident root-cause analysis, connector usage, citations, and read-only guarantees; those should be checked automatically on pull requests.

The workflow runs only the deterministic offline gate with `npm run test:sre-eval`. It does not call LLM providers, does not need a database, does not need connector credentials, and does not run a live app.

## Eval Tiers

- Deterministic gate: `npm run test:sre-eval`. Always safe for CI. Uses fixtures, required evidence/tool checks, forbidden-claim checks, and duplicate-tool-call budgets.
- Live API adapter: `createSreInvestigationApiEvalRunner()`. Opt-in for seeded environments that provide incident IDs and auth headers. Not run in default CI.
- Model grader: `gradeSreEvalResultWithModel()`. Opt-in for release-candidate evaluation. The grader must use a different model from the evaluated agent unless explicitly overridden for local experiments.

## Release Gate

Use `npm run test:sre-eval:release` for release-candidate checks. It always runs the deterministic offline gate first.

If `SRE_EVAL_LIVE_ENABLED=true`, it also runs `npm run test:sre-eval:live` after validating the live eval environment variables. If a release must include seeded live evals, set `SRE_EVAL_RELEASE_REQUIRE_LIVE=true`; the command fails if live evals are not enabled.

The GitHub Actions workflow uses this release command with offline defaults. That makes pull-request behavior identical to the first stage of release validation without requiring secrets in normal CI.

## Seeded Live Evals

Live evals are disabled by default. To run them against an approved seeded environment, set:

```bash
SRE_EVAL_LIVE_ENABLED=true
SRE_EVAL_BASE_URL=https://your-seeded-supercheck.example
SRE_EVAL_AUTH_TOKEN=...
SRE_EVAL_INCIDENT_IDS='{"native-evidence-monitor-timeout":"018f0000-0000-7000-8000-000000000001"}'
npm run test:sre-eval:live
```

`SRE_EVAL_INCIDENT_IDS` must map eval fixture IDs to seeded SRE incident IDs in the target environment. Connector-investigation fixtures automatically request live connector usage; other fixtures do not.

To run only a safe subset while preparing seed data, set a comma-separated fixture list:

```bash
SRE_EVAL_FIXTURE_IDS=connector-investigation-tempo-trace-latency,connector-investigation-cloudwatch-alarm
```

The live suite is implemented in `live-api.spec.ts` and skips unless `SRE_EVAL_LIVE_ENABLED=true`, so default CI remains offline and deterministic.

### Seeded Connector Fixtures

The current opt-in live connector fixtures cover:

| Fixture ID | Connector coverage | Required seeded evidence |
| --- | --- | --- |
| `connector-investigation-prometheus-kubernetes-restarts` | Prometheus + Kubernetes | Latency spike metric and checkout restart/topology evidence. |
| `connector-investigation-sentry-regression` | Sentry | Unresolved checkout exception/regression issue. |
| `connector-investigation-datadog-event-spike` | Datadog | `service:checkout` event for latency/deploy/error context. |
| `connector-investigation-loki-error-logs` | Loki | Checkout-labelled error log lines for upstream/dependency failure. |
| `connector-investigation-elasticsearch-error-documents` | Elasticsearch/OpenSearch | Indexed checkout error document with service/severity/timestamp fields. |
| `connector-investigation-cloudwatch-alarm` | AWS CloudWatch | Checkout alarm or metric data in the incident window. |
| `connector-investigation-tempo-trace-latency` | Grafana Tempo | Slow checkout trace with dependency span attributes. |

Seed these only in non-production tenants. Use fake/demo services, short telemetry retention, and read-only connector credentials.

## Security Rules

- Do not put secrets, connector credentials, or live customer data in fixtures.
- Run live/API evals only against seeded or approved test tenants.
- Keep model-backed grading out of default CI unless release infrastructure provides approved credentials and data handling.
- Treat deterministic eval failures as release blockers for SRE agent changes.
- Do not run live evals against customer production tenants.

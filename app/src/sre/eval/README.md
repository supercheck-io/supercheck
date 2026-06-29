# SRE Eval Gate

The SRE eval suite is a production safety gate for SuperCheck's read-only AI SRE agents.

## Why GitHub Actions

The `.github/workflows/sre-eval.yml` workflow is not required for local development or runtime behavior. It exists to prevent agent regressions from merging unnoticed. SRE agent changes can affect incident root-cause analysis, connector usage, citations, and read-only guarantees; those should be checked automatically on pull requests.

The workflow runs only the deterministic offline gate with `npm run test:sre-eval`. It does not call LLM providers, does not need a database, does not need connector credentials, and does not run a live app.

## Eval Tiers

- Deterministic gate: `npm run test:sre-eval`. Always safe for CI. Uses fixtures, required evidence/tool checks, forbidden-claim checks, and duplicate-tool-call budgets.
- Live API adapter: `createSreInvestigationApiEvalRunner()`. Opt-in for seeded environments that provide incident IDs and auth headers. Not run in default CI.
- Model grader: `gradeSreEvalResultWithModel()` and `npm run test:sre-eval:model`. Opt-in for release-candidate evaluation. The model-grade command reruns the seeded live suite to collect agent outputs, then grades those outputs with an independent model.

## Release Gate

Use `npm run test:sre-eval:release` for release-candidate checks. It always runs the deterministic offline gate first.

Release behavior is controlled by `SRE_EVAL_RELEASE_CHANNEL`:

| Channel | Deterministic eval | Seeded live eval | Model-graded eval |
| --- | --- | --- | --- |
| unset / `local` / `pull_request` | Blocking | Skipped unless `SRE_EVAL_LIVE_ENABLED=true` | Skipped unless `SRE_EVAL_MODEL_GRADE_ENABLED=true` |
| `canary` | Blocking | Advisory when enabled | Advisory when enabled |
| `release_candidate` / `rc` | Blocking | Blocking and required | Blocking and required |
| `stable` / `production` | Blocking | Blocking and required | Blocking and required |

Explicit overrides are available:

- `SRE_EVAL_RELEASE_REQUIRE_LIVE=true` requires `SRE_EVAL_LIVE_ENABLED=true` on any channel.
- `SRE_EVAL_RELEASE_REQUIRE_MODEL_GRADE=true` requires `SRE_EVAL_MODEL_GRADE_ENABLED=true` on any channel.

If `SRE_EVAL_LIVE_ENABLED=true`, the release command runs `npm run test:sre-eval:live` after validating the live eval environment variables.

If `SRE_EVAL_MODEL_GRADE_ENABLED=true`, the release command runs `npm run test:sre-eval:model`. Model grading requires live evals because it grades actual seeded investigation outputs. It also requires `SRE_EVAL_EVALUATED_MODEL_ID`; set `SRE_EVAL_GRADER_MODEL_ID` when the release infrastructure pins a grader model. The grader model must differ from the evaluated model unless `SRE_EVAL_MODEL_GRADE_ALLOW_SAME_MODEL=true` is set for local experiments. `SRE_EVAL_MODEL_GRADE_MIN_SCORE` defaults to `0.8`.

The GitHub Actions workflow uses this release command with offline defaults. That makes pull-request behavior identical to the first stage of release validation without requiring secrets in normal CI.

### Release Seed Manifest

Use the checked-in seed manifest to generate a safe environment template or a markdown runbook for release infrastructure:

```bash
npm run sre-eval:release-env
npm run sre-eval:release-env -- --channel=stable --fixture-ids=connector-investigation-oss-lab-checkout-degradation
npm run sre-eval:release-env -- --format=markdown
```

The generated template intentionally contains placeholders only. Populate real values in the CI secret store or release environment, not in source control.

Release engineers must verify before RC/stable gates:

- The target is a seeded non-production SuperCheck tenant.
- `SRE_EVAL_AUTH_TOKEN` is scoped to the eval tenant and can run SRE investigations only.
- `SRE_EVAL_INCIDENT_IDS` maps every selected fixture to a seeded SRE incident.
- All selected connectors use read-only credentials and fake/demo data.
- The grader model is independent from the evaluated model.
- Live/model failures block `release_candidate` and `stable`; do not downgrade them to advisory for production releases.

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

## Model-Graded Release Evals

Model grading is disabled by default. To run it in a seeded release-candidate or stable environment:

```bash
SRE_EVAL_RELEASE_CHANNEL=release_candidate
SRE_EVAL_LIVE_ENABLED=true
SRE_EVAL_MODEL_GRADE_ENABLED=true
SRE_EVAL_EVALUATED_MODEL_ID=investigator-model-id
SRE_EVAL_GRADER_MODEL_ID=independent-grader-model-id
SRE_EVAL_BASE_URL=https://your-seeded-supercheck.example
SRE_EVAL_AUTH_TOKEN=...
SRE_EVAL_INCIDENT_IDS='{"connector-investigation-oss-lab-checkout-degradation":"018f0000-0000-7000-8000-000000000001"}'
npm run test:sre-eval:release
```

The model-grade command intentionally reuses seeded live fixtures and bounded agent outputs. It does not grade synthetic prompt-only examples, and it should not run against customer production incidents.

### Seeded Connector Fixtures

The current opt-in live connector fixtures cover:

| Fixture ID | Connector coverage | Required seeded evidence |
| --- | --- | --- |
| `connector-investigation-prometheus-kubernetes-restarts` | Prometheus + Kubernetes | Latency spike metric and checkout restart/topology evidence. |
| `connector-investigation-oss-lab-checkout-degradation` | Prometheus + Loki + Tempo | Local OSS lab demo service metrics, logs, and trace spans for checkout degradation. |
| `connector-investigation-sentry-regression` | Sentry | Unresolved checkout exception/regression issue. |
| `connector-investigation-datadog-event-spike` | Datadog | `service:checkout` event for latency/deploy/error context. |
| `connector-investigation-loki-error-logs` | Loki | Checkout-labelled error log lines for upstream/dependency failure. |
| `connector-investigation-elasticsearch-error-documents` | Elasticsearch/OpenSearch | Indexed checkout error document with service/severity/timestamp fields. |
| `connector-investigation-cloudwatch-alarm` | AWS CloudWatch | Checkout alarm or metric data in the incident window. |
| `connector-investigation-tempo-trace-latency` | Grafana Tempo | Slow checkout trace with dependency span attributes. |

Seed these only in non-production tenants. Use fake/demo services, short telemetry retention, and read-only connector credentials.

### OSS Integration Lab

The optional Docker Compose lab in `deploy/docker/docker-compose-aisre-lab.yml` provides a low-cost local target for seeded connector checks. It includes:

- `aisre-demo-service` with `/checkout`, `/checkout/slow`, `/checkout/error`, and `/metrics`.
- Prometheus and Alertmanager for metric and alert fire/recovery coverage.
- Loki and Promtail for structured checkout logs.
- Tempo and OpenTelemetry Collector for trace evidence.
- Grafana with provisioned Prometheus, Loki, and Tempo data sources.
- `aisre-webhook-capture` for inspecting Alertmanager or SuperCheck webhook payloads.

Start the full lab from `deploy/docker`:

```bash
docker compose -f docker-compose.yml -f docker-compose-aisre-lab.yml --profile aisre-lab up -d
```

Generate seed signals:

```bash
curl http://127.0.0.1:18080/checkout
curl http://127.0.0.1:18080/checkout/slow
curl http://127.0.0.1:18080/checkout/error
```

Use `SRE_EVAL_FIXTURE_IDS=connector-investigation-oss-lab-checkout-degradation` for the lab-specific live fixture after creating a seeded test incident and connecting the lab Prometheus, Loki, and Tempo endpoints to a non-production SuperCheck project.

## Security Rules

- Do not put secrets, connector credentials, or live customer data in fixtures.
- Run live/API evals only against seeded or approved test tenants.
- Keep model-backed grading out of default CI unless release infrastructure provides approved credentials and data handling.
- Treat deterministic eval failures as release blockers for SRE agent changes.
- Treat seeded live and model-graded eval failures as release blockers for `release_candidate` and `stable` channels.
- Do not run live evals against customer production tenants.

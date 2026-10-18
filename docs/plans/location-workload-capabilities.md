# Per-location workload capabilities: lightweight monitors only in US/SGP, EU keeps Playwright and k6

## Context

The plan is to offer HTTP, SSL, ping and port monitors from EU, US and Singapore, and to run Playwright (synthetic monitors, tests, CI jobs) and k6 only in EU. Later, enabling browser or k6 execution in another region should be a configuration change, not a code release. Existing self-hosted installs must not change behaviour.

I checked the other agent's analysis against the source and agree with it. Its main claims are confirmed:

- **`WORKER_QUEUES` does not exist.** Every worker consumes `playwright-global` and `k6-global` through static `@Processor` classes, so a US or SGP worker would pick up global browser and k6 jobs. `K6DynamicWorkerService` also consumes `k6-<loc>` as soon as that location is enabled in the DB.
- **There is no capability concept.** `resolveProjectK6Location` (`app/src/lib/location-registry.ts:353`) and `resolveMonitorLocations` (`app/src/lib/monitor-location-routing.ts:29`) accept any enabled, project-permitted location.
- **Execution Jobs are not pinned to a region.** The gVisor RuntimeClass only selects `gvisor.io/enabled=true`, which every regional worker node carries, and no manifest sets `EXECUTION_NODE_SELECTOR`. A malformed selector is silently dropped with only a warning.
- **KEDA watches only `:wait` lists**, but monitor jobs use priorities 1 and 10, so they sit in `:prioritized`.
- **The `regional-launch` overlay** reduces EU from 2 replicas to 1, sets every ScaledObject to min = max = 1, and keeps the global heavy-queue triggers on US and APAC.

The location codes stay as they are: `eu-central`, `us-east` and `asia-pacific` (the Singapore server). These are geographic codes, and the node labels and deployments already use them.

## Design

There are four independent controls. None of them changes another automatically.

| Control | Where | Decides |
|---|---|---|
| `supports_browser`, `supports_k6` (new DB columns) | `locations` table, Super Admin | Which workloads users may run in a location |
| `WORKER_QUEUES` (new worker env var) | worker deployment | Which queue consumers a worker starts |
| `EXECUTION_NODE_SELECTOR` | ops overlay | Where execution pods physically run |
| KEDA and autoscaler limits | ops | How much capacity can be created |

Backward compatibility rules:

- Both capability columns are `NOT NULL DEFAULT true`. Existing rows, the self-hosted `local` row and cloud EU keep working with no action.
- When `WORKER_QUEUES` is omitted, the worker consumes everything, exactly as today.
- Turning US/SGP capabilities off is an explicit Super Admin action during the cloud rollout. That policy is never written into the shared migration.

## Adding or removing locations later (e.g. Brazil, or four more regions)

Location codes, monitor queues and regional k6 queues are already dynamic. They come from the DB `locations` table and are refreshed over pub/sub. This change makes *what runs where* configuration too. No region-specific code exists in the app or worker.

What goes where:

| What | Product truth (Super Admin, DB) | Infra truth (deployment) |
|---|---|---|
| A location exists and is selectable | `is_enabled`, `is_default`, project restrictions | a worker with `WORKER_LOCATION=<code>` that sends heartbeats |
| HTTP/SSL/ping/port monitors | always allowed when enabled | worker consumes `monitor` |
| Synthetic (Playwright) monitors in that region | `supports_browser` | the node is sized for browsers. No queue token is needed, because synthetic monitors run from the monitor queue. |
| k6 pinned to that region | `supports_k6` | worker consumes `k6` (its own `k6-<code>` queue) |
| Location-less work: Playwright tests/CI, and k6 `"global"` | — | worker consumes `global-playwright` / `global-k6` |

`WORKER_QUEUES` therefore has four tokens: `monitor`, `k6`, `global-playwright` and `global-k6`. If it is unset, the worker consumes all four, which is today's behaviour.

- Enabling browser or k6 in a region never enrolls that region in the global CI or k6 pools; those are separate tokens.
- The app builds `k6-<code>` queue maps only for k6-capable locations. `K6DynamicWorkerService` discovers `is_enabled AND supports_k6` locations. A region therefore can't receive regional k6 work unless both the DB and the worker allow it.
- At startup, the worker logs a warning when its env and the DB disagree, e.g. it consumes `k6` but `supports_k6=false`. It does not change anything automatically.

**Runbook for a new location `sa-east`.**

1. Provision the region's worker: a deployment carrying `WORKER_LOCATION` and `WORKER_QUEUES=monitor`,
   pinned to that region's nodes, with a scaler that watches only `monitor-sa-east` and a pod
   disruption budget. Re-check the capacity budget before adding the nodes.
2. Super Admin: create `sa-east`. Its default is **disabled** with both capabilities **off**. Check that heartbeats arrive and the region shows Active.
3. Enable it. Monitors can then be scheduled there.
4. Later, to add browser support: resize the pool, validate an in-region run, then turn on `supports_browser`. No release is needed. For k6: add the `k6` token to that worker and turn on `supports_k6`.
5. Removal: disable the location. The existing DELETE guard requires empty queues, then the worker can be torn down. Saved monitor selections stay and show as unavailable.

**Self-hosted.** A self-hosted install runs `WORKER_LOCATION=local` with no `WORKER_QUEUES`. Existing rows default to `true/true`, so nothing breaks and no breaking release is needed. Remote self-hosted regional workers (`docker-compose-worker.yml`) keep working, and they can optionally set `WORKER_QUEUES`.

**Defaults for new locations.** The API accepts the capabilities as optional, defaulting to true; this matches today's behaviour for API clients. The admin dialog shows both switches explicitly, and in cloud mode they are pre-set to off. The new-location dialog defaults to creating the location disabled in cloud mode.

**Not restructured.** I'm keeping `playwright-global` and `k6-global` rather than replacing them with per-location `playwright-<code>` queues. Tests and CI have no geographic meaning today, and the rewrite would touch capacity management, cancellation, Bull Board and queue events for no gain at launch. If region-pinned CI is wanted later, it follows the same pattern: a `playwright-<code>` queue, the `supports_browser` gate and a `playwright` token.

## PR 1 — `supercheck` (app + worker), branch `feat/location-workload-capabilities`

### A. Schema and admin
- `app/src/db/schema/locations.ts`: add `supportsBrowser` and `supportsK6` as boolean, not null, default true. The drizzle-zod schemas pick them up automatically.
- Write `app/src/db/migrations/0029_location_workload_capabilities.sql` by hand, using `ADD COLUMN IF NOT EXISTS ... DEFAULT true NOT NULL`, and append it to `meta/_journal.json`.
  - **Do not run `db:generate`.** The snapshots stop at 0014, so it would regenerate DDL that migrations 0015 to 0028 already applied.
- `app/src/lib/validations/location.ts`: add both fields to the create schema (optional, defaulting to true) and the update schema (optional).
- `api/admin/locations/route.ts` (POST, and `LocationWithStatus`) and `api/admin/locations/[id]/route.ts` (PATCH): persist the fields and run the existing cache and queue invalidation.
- `add-location-dialog.tsx` and `edit-location-dialog.tsx`: add two switches, "Browser execution (Playwright)" and "Performance tests (k6)". Show them as badges in `locations-table.tsx`, and extend the types in `use-locations.ts`.

### B. Central eligibility (`app/src/lib/location-registry.ts`)
- Add `type LocationWorkload = "monitor" | "browser" | "k6"`. Extend the cache with a `capabilities: Record<code, {browser, k6}>` map. Export `locationSupportsWorkload(code, workload)` and `filterCodesByWorkload(codes, workload)`.
  - `monitor` is always supported, so HTTP, ping and port monitors behave exactly as today.
- Pass `{ workload }` to `getProjectAvailableLocationCodes`, `getFirstProjectAvailableLocationCode` and `normalizeK6Location`. With no workload, behaviour is unchanged.
- **`resolveProjectK6Location`:**
  - **No value:** use the first project-available location that supports k6. If there is none, throw `LocationWorkloadUnavailableError` ("Performance tests are not available in this project's locations").
  - **`"global"`:** keep the existing rejection for restricted projects, and also reject when no enabled location supports k6.
  - **An explicit code:** reject it if it is not k6-capable, with a clear message.
  - This one change covers `api/test`, `tests/[id]/execute`, `jobs/run`, `jobs/[id]/trigger` and `scheduler/job-scheduler.ts`.
- Add `assertProjectSupportsBrowser(projectId)` for Playwright tests and CI jobs. These have no location today and run on `playwright-global` in EU. A project whose permitted locations include no browser-capable one gets an "unavailable" error, with no silent fallback. Existing installs are unaffected because the default is true. Call sites: the Playwright branches of the same four routes and the job scheduler.

### C. Monitor routing (`app/src/lib/monitor-location-routing.ts`)
- `resolveMonitorLocations(locationConfig, projectId, { monitorType })`: when the type is `synthetic_test`, apply the browser filter.
  - **Explicit configuration:** after filtering, throw the existing resolution error if nothing is left. Its message should say which locations lack browser support, so it reads as a configuration error and not as "offline".
  - **Default locations:** resolve only within browser-capable, project-permitted locations.
  - The filter runs before `partitionMonitorLocationsByAvailability`. A location is never replaced by one in another geography.
- Thread `monitorType` through every caller: `scheduler/monitor-scheduler.ts` `enqueueMonitorExecutionJobs` and the scheduling-failure attribution path, plus `queue.ts` `addMonitorExecutionJobToQueue`.
- Add `synthetic_test` to `MonitorJobData.type` in `queue.ts:113` and `scheduler/monitor-scheduler.ts:32`, and remove the casts in `monitor-service.ts`.
- Aggregation and alerting are unchanged. They receive the final `expectedLocations` as they do today.

### D. Save-time validation
- `api/monitors/route.ts` (POST and PUT), and also `api/monitors/[id]/route.ts` (PUT and PATCH), which have no location validation today.
  - When `locationConfig.enabled` and the type is `synthetic_test`, reject non-browser codes with a 400: "Browser checks are not available in: …".
  - The effective type is checked on a type change, so switching an HTTP monitor with US/SGP selected to synthetic is rejected.
  - Selections that were already saved are never rewritten or deleted.

### E. k6 capacity promotion
- `app/src/lib/capacity-manager.ts:629-670`: when a job is promoted, re-check `locationSupportsWorkload(location, "k6")` for regional codes. If the check fails, take the existing "queue disappeared" failure path.

### F. Worker queue consumers and heartbeats
- New `worker/src/common/worker-queues.ts`: parse `WORKER_QUEUES`, a comma list from `monitor`, `k6`, `global-playwright` and `global-k6`.
  - Unset or empty means all four.
  - `K6DynamicWorkerService` discovery adds `AND supports_k6 = true`, and the app's `getQueues()` builds `k6-<code>` only for k6-capable codes.
  - At startup, log a warning when the env and the DB capabilities disagree.
  - An unknown token makes the worker fail fast at startup.
  - Export `consumes(workload)`.
- **Static consumers:**
  - Move the body of `PlaywrightExecutionProcessor` and `K6ExecutionProcessor`/`BaseK6ExecutionProcessor` into plain services, or keep `handleProcess` on an injectable service.
  - Register the thin `@Processor` classes in `ExecutionModule` and `K6Module.forRoot()` only when that workload is consumed.
  - `K6DynamicWorkerService` depends on the service, not on the processor.
  - `ExecutionService` and its dependencies are always provided, because synthetic monitors call `runSingleTest` directly.
  - Before choosing, check whether the installed `@nestjs/bullmq` honours `autorun:false`. Splitting into services is the default because it is robust.
- **Dynamic consumers:** `K6DynamicWorkerService` creates no global or regional k6 workers when k6 is not consumed. `MonitorDynamicWorkerService` creates none when monitor is not consumed.
- **Heartbeats** (`common/heartbeat/heartbeat.service.ts:34`): drop the hardcoded initial `{'playwright-global'}`. Each consumer registers its queue when it starts, so heartbeats advertise only what is actually consumed.
- Update `.env.example`: document `WORKER_QUEUES`, `EXECUTION_NODE_SELECTOR` and `EXECUTION_TOLERATIONS_JSON`, fix the stale `WORKER_LOCATION` text, and remove the dead `ENABLE_LOCATION_FILTERING`.

### G. Worker backstops
- Extend `worker/src/common/location/location.service.ts` with a short-TTL cached capability lookup.
- **Monitor** (`monitor-dynamic-worker.service.ts` `processJob`):
  - Check only on the execute path, never when a result is already `saved` or the job is `aggregationOnly`.
  - For `synthetic_test`, check `job.data.executionLocation` for `supports_browser`. Revoked capability throws `UnrecoverableError`, so the existing `handleFinalJobFailure` still completes aggregation and records an error result.
  - If the DB lookup fails, throw a normal retryable error. Unknown capability is never treated as allowed.
  - HTTP, ping and port monitors are never checked.
- **k6** (`k6-execution.processor` `handleProcess`): for a non-global, non-wildcard `job.data.location`, require `supports_k6`. On failure, throw `UnrecoverableError` with a clear message.
- **Execution placement guard** (`container-executor.service.ts` `parseExecutionNodeSelector`/`parseExecutionTolerations`): in cloud production, malformed values throw at startup, using the same condition as the runtime-class check. Elsewhere they still only warn.

### H. UI
- Add `supportsBrowser` and `supportsK6` to `api/locations/available`, which still returns every location, unfiltered.
- `location-config-section.tsx` gets a `monitorType` prop.
  - For synthetic monitors, unsupported locations are visible but disabled, with the copy "Browser checks are not available in this region."
  - The auto-cleanup at lines 152-178 stays based on availability only. Capability never removes a saved selection; instead, an inline warning lists the unsupported selected codes, and the server rejects the save.
  - Wire the prop in `monitor-form.tsx`, `monitor-creation-wizard.tsx` (including the single-location shortcut and the sessionStorage restore) and the edit page.
- k6: in `performance-locations.ts` `buildPerformanceLocationOptions`, mark non-k6 locations as disabled with "Performance tests are not available in this region.", and offer `global` only when some location supports k6. Make sure the auto-cleanup in `playground/index.tsx:628-644` cannot pick a disabled location.

### I. Tests (jest, next to the source)
- `location-registry.spec.ts`: capability cache, workload filtering, k6 default/explicit/global resolution, restricted US-only project gets an error for k6 and for browser, and calls with no workload behave unchanged.
- `monitor-location-routing.spec.ts`: synthetic explicit config with all locations ineligible throws, defaults resolve within capable locations, HTTP is unaffected, and there is no cross-region fallback.
- `scheduler/monitor-scheduler.spec.ts` and `queue.spec.ts`: `monitorType` is threaded through.
- Monitor route specs: 400 on an unsupported synthetic selection, rejection on a type change, and an existing disabled config is preserved.
- `capacity-manager.spec.ts`: promotion fails when capability is revoked.
- Worker:
  - `worker-queues.spec.ts`: unset means all, invalid fails.
  - Module tests: no Playwright/k6 consumers and no global heartbeat queues when `WORKER_QUEUES=monitor`.
  - Monitor backstop: revoked capability gives an unrecoverable error, an aggregation-only retry bypasses the check, and a DB error is retryable.
  - k6 backstop.
  - `container-executor.service.spec.ts`: malformed selector fails fast in cloud production and only warns in self-hosted.

## PR 2 — regional probe worker manifests (config only, no cluster apply)

Deployment configuration is tracked outside this repository. The change is config only:

- each regional worker gets a node selector pinning it to its region. It stays unset in the base, so staging and self-hosted don't inherit it.
- Check which nodes carry the gVisor and region labels before choosing the selector. Execution pods currently land on app and master nodes; if EU masters should keep running them, they need a region label. Do not change node labels on a live cluster.
- US and APAC workers get `WORKER_QUEUES=monitor`.
- Remove the global playwright and k6 scaler triggers from US and APAC so they watch only their region's monitor queue.
- EU keeps its current replica count. Set US and APAC to one warm replica, and cap the autoscaler so primary plus fallback per region stays inside the intended node budget.
- Add a reusable per-region template plus per-region directories, so a new location is a copy-and-edit. Rendered output for existing regions must be byte-equivalent to the intended diff (no accidental changes).
- Render every overlay and diff the output against the current state before applying.

The capacity budget needs re-checking as part of this change.

## Deferred (explicitly out of scope here)
- **A KEDA backlog metric that counts `:prioritized` jobs.** KEDA's redis list trigger can't read a sorted set, so this needs a metrics-api or Prometheus source. Launch runs on fixed replicas, as production already does.
- **The rollout itself:** provision the US/SGP nodes, run the acceptance and load tests, set US/SGP to `supports_browser=false, supports_k6=false` in Super Admin, then enable those rows.
- **Pricing page and in-app billing copy.** Change it only after regional acceptance, using the wording in the analysis.

## Verification
- App (`supercheck/app`): `npx next typegen && npx tsc --noEmit`, `npm run lint`, `npm test`.
- Worker (`supercheck/worker`): `npx tsc --noEmit`, `npm run lint:check`, `npm test`.
- Migration: apply 0029 to the local compose Postgres with `npm run db:migrate`, confirm existing rows read `true`/`true`, and confirm a re-run is a no-op.
- Local smoke test (hybrid compose):
  - The default worker with no `WORKER_QUEUES` still runs a Playwright test, a k6 test and a synthetic monitor on `local`.
  - A worker with `WORKER_QUEUES=monitor` advertises only `monitor-*` in its heartbeat (`redis-cli GET supercheck:worker-heartbeat:*`).
- Render the deployment manifests for every overlay and confirm the capacity budget.
- Run the code-reviewer and security-reviewer subagents on both diffs and fix their findings.
- Handoff prompt for the DeepSeek tester: negative-scenario matrix plus backward-compatibility tests for when the setting is omitted. I'll provide it after PR 1 is up.

## Process
- Branch and PR for the app and worker changes; never push to main.
- Commit as krish-kant with no AI trailers.
- Deployment configuration is reviewed as a separate change, and change descriptions stay self-contained rather than linking across repositories.

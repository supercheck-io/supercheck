# Dependabot validation report

## Result

The validation branch integrates a compatible subset of the open Dependabot updates and fixes the compatibility issues found during integration. The original PR heads were not all tested independently. Keep the replacement PR in draft while the remaining browser blockers are resolved; there is no merge recommendation yet.

No PRs were merged and no deployments were made. The change branch is based on `origin/main` commit `decc827c` (`chore/dependency-validation-20261022`). All 37 original PR heads were unchanged in the final inventory snapshot.

## Validation evidence

| Check | Baseline | Current branch | Result |
| --- | --- | --- | --- |
| App unit/coverage tests | 381 suites / 4,595 tests | 382 suites / 4,596 tests passed; 3 suites / 6 tests skipped | Pass |
| Worker unit/coverage tests | 70 suites / 1,632 tests | 70 suites / 1,632 tests passed; 2 suites / 44 tests skipped | Pass |
| CLI unit/coverage tests | 45 suites / 667 tests | 45 suites / 667 tests passed | Pass |
| Recorder unit tests | — | 24 unit tests, including 5 new config tests | Pass |
| App type/lint/build | Baseline recorded in evidence logs | Final rebuild and checks passed | Pass |
| Worker type/lint/container build | Baseline recorded in evidence logs | Final type/lint passed; final image build compiled source successfully | Pass |
| CLI type/lint/build | Baseline recorded in evidence logs | Final type/lint/build passed | Pass |
| Recorder lint/build | Baseline recorded in evidence logs | Final lint and production/test-extension builds passed | Pass |
| Docs checks/build | Baseline Webpack build passed; default Turbopack stalled | OpenAPI, diagrams, lint, tests, and final Webpack build passed | Pass |
| E2E package | — | Type checks and test listing pass | Pass; browser acceptance below is partial |
| PostgreSQL integration | — | App 193 tests; worker DB test 1; monitor-cycle 43 tests | Pass on isolated local PostgreSQL |
| SRE checks | — | 19 deterministic checks pass; 2 live checks skipped | Partial; live checks remain unverified |
| Worker container smoke | — | Final image built with Go 1.27.2 and Playwright 1.64.1; one k6 iteration smoke passed | Pass for recorded smoke only |
| Local app/worker health | — | Both health checks green | Pass |
| Monaco browser check | — | Monaco 0.57 declarations resolve; `goto` / `getByRole` flow passes; TypeScript TS2345 check passes | Pass for these checks |
| App browser suite after schema fix | — | 47 passed, 1 failed: status-page publish action leaves draft state unchanged | Blocked on the publish-state failure; separate production-configured rerun had 3 pass and the same 1 failure, so do not label it a flake |
| Recorder browser suite | — | Checkbox selector was corrected to a switch; rerun still stalls on a redundant worker and was interrupted | Pending; baseline cached-Chromium experiment also showed the redundant worker, but full unchanged-baseline suite was not run |
| CLI API acceptance | — | `whoami`, test/monitor/job listing, locations, and token revoke (HTTP 200) passed | Pass |
| Fullscreen flow | — | Worker loaded; Escape and button both closed fullscreen | Pass |
| Local Kubernetes execution | — | Playwright browser and k6 execution tests passed | Pass locally; no production gVisor acceptance |
| Job execution | — | Browser flow triggered the selected job and persisted a run | Pass for this flow |

The app browser rerun used an owner credential for the owner/project-admin fixture; it did not independently validate a separately authenticated `project_admin` RBAC identity. The schema export compatibility fix is covered below. The original baseline lockfile also builds in production mode. Its browser comparison did not reach the component form and is inconclusive; the publish failure is not attributed to either dependency updates or baseline behavior. The invalid runtime schema export already existed in baseline source. Hosted CI must be refreshed against the final pushed draft before merge readiness can be assessed.
## Compatibility changes and exclusions

- Monaco 0.57 API updates cover three editor components and a helper. The shared loader CDN and app package are pinned to 0.57; `@monaco-editor/loader` 1.7.0 is required for its direct exports. Shared config covers all six editors and prefetch, with config specs and mocks.
- Worker ESLint 10 / `typescript-eslint` 8.71 cleanup applied autofixes across 24 files and manually fixed three remaining errors. The CLI config declares `@eslint/js` ^10 and `typescript-eslint` 8.71 while preserving existing config imports. The one-line CLI lint fix was independently reviewed.
- App server-action specs use the Node test environment for the AWS SDK browser-ESM change. Virtualizer tests set `clientHeight` and `clientWidth` for the upstream measurement behavior. Recorder changes add Chrome 130 storage type generics, a config-event `unknown` guard, and a test.
- Grouped PRs #537 and #532 exclude `drizzle-zod` 0.8 because its Zod 4 output conflicts with Zod 3 callers. PR #537 retains Next config 16.3.8 with an `eslint-plugin-react-hooks` 7.0.1 override while keeping Next runtime 16.4.
- Docs group #519 retains Fuma Core/UI 16.8.0 because 16.17.5 removes translation-context `.text`, still read by OpenAPI 10.6 as `.text.openapi`; it also retains `mdast` serializer 2.1.2 because 2.2 recursed. Other group members are included in the candidate subset.
- The Zod schema runtime export was moved unchanged to `lib/validations/incident-status.ts`; the reviewer approved this compatibility fix. The app rebuild passed, followed by four regression tests.

## Security status

The finalized security audit at `/private/tmp/dependency-security-audits/SECURITY_REVIEW.md` reports no new HIGH or CRITICAL IDs and two new LOW Monaco vendored DOMPurify `IN_PLACE` advisories with no `IN_PLACE` caller found. Remaining HIGH findings are in development-only dependency nodes. This is not a zero-vulnerability claim. The latest recorder security review is pending.

## Open PR decisions

The live inventory below contains all 37 PRs from `/private/tmp/supercheck-dependencies-live.json`; titles and versions are copied from that snapshot. “Include in candidate replacement subset” is not approval to merge the original PR head: individual PR heads were not all tested independently. Final local gates, outstanding browser checks, and hosted CI must pass before recommending the replacement PR.

| PR | Exact live title | Decision |
| --- | --- | --- |
| #541 | build(deps): bump @tanstack/react-table from 8.21.3 to 9.3.1 in /app | Defer: Table 9 removes the `useReactTable` API used by the app. |
| #540 | build(deps): bump react-email from 4.3.2 to 6.11.3 in /app | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #539 | build(deps): bump @kubernetes/client-node from 1.4.0 to 2.0.0 in /app | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #538 | build(deps): bump @ai-sdk/anthropic from 3.0.118 to 4.0.82 in /app | Defer: Anthropic 4 model V4 is incompatible with AI SDK 6. |
| #537 | build(deps): bump the app-minor-patch group in /app with 69 updates | Superseded by the replacement subset: exclude `drizzle-zod` 0.8 (Zod 4 output conflicts with Zod 3 callers); retain Next config 16.3.8 with `eslint-plugin-react-hooks` 7.0.1 override while retaining Next runtime 16.4. |
| #536 | build(deps-dev): bump @nestjs/schematics from 11.1.0 to 12.0.7 in /worker | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #535 | build(deps-dev): bump eslint from 9.39.2 to 10.13.0 in /worker | Include in replacement subset after ESLint 10 cleanup; worker redundant assertion/formatting cleanup was applied. |
| #534 | build(deps): bump uuid from 11.1.1 to 14.0.3 in /worker | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #533 | build(deps-dev): bump typescript from 5.9.3 to 7.0.2 in /worker | Defer: TypeScript 7 removes the JavaScript compiler API required by `ts-jest` and ESLint integrations. |
| #532 | build(deps): bump the worker-minor-patch group in /worker with 24 updates | Superseded by the replacement subset: exclude `drizzle-zod` 0.8 because its Zod 4 output conflicts with Zod 3 callers. |
| #531 | build(deps): bump react and @types/react in /recorder | Defer: React 19 with ReactDOM 18 fails at runtime in recorder. |
| #530 | build(deps-dev): bump codemirror from 5.65.18 to 6.0.2 in /recorder | Defer: the root CodeMirror 6 package does not upgrade the actually vendored CodeMirror 5. |
| #529 | build(deps): bump the recorder-minor-patch group in /recorder with 19 updates | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #528 | build(deps): bump docker/build-push-action from 6.19.2 to 7.4.0 | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #527 | build(deps): bump shiki from 3.23.0 to 4.5.0 in /docs | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #526 | build(deps): bump docker/metadata-action from 5.10.0 to 6.2.0 | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #525 | build(deps-dev): bump eslint from 9.39.2 to 10.13.0 in /docs | Include in replacement subset after ESLint 10 cleanup. |
| #524 | build(deps): bump docker/setup-qemu-action from 3.7.0 to 4.4.0 | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #523 | build(deps-dev): bump typescript from 5.9.3 to 7.0.2 in /docs | Defer: TypeScript 7 removes the JavaScript compiler API required by `ts-jest` and ESLint integrations. |
| #522 | build(deps): bump actions/cache from 5.1.0 to 6.1.0 | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #521 | build(deps): bump actions/upload-artifact from 7.0.1 to 7.0.2 in the actions-minor-patch group | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #520 | build(deps-dev): bump @types/node from 24.6.2 to 26.6.5 in /docs | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #519 | build(deps): bump the docs-minor-patch group in /docs with 12 updates | Superseded by the replacement subset: retain Fuma Core/UI 16.8.0 because 16.17.5 removes translation-context `.text`, which OpenAPI 10.6 still reads as `.text.openapi`; exclude `mdast` serializer 2.2 because it recurses (retain 2.1.2). Other group members are included in the candidate subset. |
| #518 | build(deps-dev): bump typescript from 5.9.3 to 7.0.2 in /cli | Defer: TypeScript 7 removes the JavaScript compiler API required by `ts-jest` and ESLint integrations. |
| #517 | build(deps): bump wrap-ansi from 8.1.0 to 10.0.2 in /cli | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #516 | build(deps): bump conf from 13.1.0 to 16.0.0 in /cli | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #515 | build(deps-dev): bump eslint from 9.39.2 to 10.13.0 in /cli | Include in replacement subset after ESLint 10 cleanup; CLI declares `@eslint/js` ^10 and `typescript-eslint` 8.71 for ESLint 10 while keeping existing config imports. |
| #514 | build(deps): bump the cli-minor-patch group in /cli with 6 updates | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #513 | build(deps-dev): bump typescript from 5.9.3 to 7.0.2 in /app/e2e | Include in replacement subset: TypeScript check and E2E type/list checks pass; browser acceptance is pending. |
| #512 | build(deps-dev): bump dotenv from 16.6.1 to 18.0.8 in /app/e2e | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #511 | build(deps-dev): bump @types/node from 20.19.25 to 26.6.5 in /app/e2e | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #510 | build(deps-dev): bump @playwright/test from 1.64.0 to 1.64.1 in /app/e2e in the app-e2e-minor-patch group | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #509 | build(deps): bump playwright from v1.64.0-noble to v1.64.1-noble in /worker | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #508 | build(deps): bump node from 24-bookworm-slim to 25-bookworm-slim in /docs | Defer: Node 25 conflicts with the current runtime support policy and package engines. |
| #507 | build(deps): bump node from 24-slim to 25-slim in /cli | Defer: Node 25 conflicts with the current runtime support policy and package engines. |
| #506 | build(deps): bump golang from 1.26.9-alpine to 1.27.2-alpine in /worker | Include in the candidate replacement subset, subject to final gates. This original PR head was not independently established as merge-ready. |
| #505 | build(deps): bump node from 24-bookworm-slim to 25-bookworm-slim in /app | Defer: Node 25 conflicts with the current runtime support policy and package engines. |

## Evidence and remaining work

Validation logs and runner artifacts are under `/private/tmp/supercheck-dependency-validation/`; the live PR snapshot is `/private/tmp/supercheck-dependencies-live.json`. No credentials, private environment contents, kubeconfig contents, or operational PR links are included here.

Before merge readiness: resolve the app status-page publish-state failure and obtain a conclusive baseline runtime comparison; investigate the recorder redundant-worker stall, keeping the baseline cached-Chromium experiment distinct from a full baseline suite; refresh hosted CI for the draft after push; reviewer approval and the unchanged 37 original heads were refreshed locally. Two live SRE checks remain skipped, and production gVisor acceptance was not run. No merge or deployment is authorized by this report.

# Supercheck E2E coverage contract

This is a traceability contract, not a test-count score. A capability is covered
only when its current implementation has deterministic assertions, isolated data,
strict cleanup, required identities, and an executable environment profile.

Authoritative catalogs are the product implementation and the private testing
specifications, especially
`supercheck-ee/specs/09-testing-qa/AI_SRE_TESTING_RUNBOOK.md`.

## Non-negotiable design rules

- API assertions prove authentication, authorization, validation, tenant scope,
  response contracts, and persistence.
- UI assertions prove user-visible behavior. Prefer API seed, exact UI action,
  API persistence assertion, and mandatory cleanup.
- Never use an arbitrary first record, broad status range, URL-only assertion,
  conditional pass, swallowed error, or dynamic skip as coverage.
- Dedicated destructive identities are mandatory for session, lockout, invitation,
  and six-role RBAC tests. Missing credentials fail preflight.
- The full suite uses only dependencies already available to the deployed
  application. Mailbox delivery and third-party webhook/connector availability
  are intentionally outside this regression gate.
- Passed tests do not retain screenshots or video. Failures retain screenshots
  and traces. CI retries are disabled so flakes fail the gate visibly.
- Every deployment profile must first assert the exact 40-character build SHA
  returned by `/api/health`.

## Current executable inventory

Verified locally on 2026-07-22:

- Default config discovery: **166 tests in 40 files**, including one auth setup.
- Exact-revision full runtime: **166 passed, 0 failed, 0 retried, 0 skipped**
  in **5.1 minutes** against build
  `39f0f74d4a12f4f911749bfabb5f12df3877812c`.
- Default E2E TypeScript compilation: passed.
- App unit suite: **1,834 passed**, with two opt-in external suites skipped by
  their explicit local policy.
- Worker unit suite: **662 passed**.
- Deterministic SRE release gate: **19 passed**; live and model grading remain
  explicit external release profiles.
- Repository diff whitespace validation: passed.
- Dynamic `test.skip` / `describe.skip` in executable E2E tests: none.
- All required dedicated identities, including all six RBAC roles, were
  provisioned and exercised by the full runtime.
The single `e2e-full.yml` workflow runs this inventory using
`playwright.config.ts`. It can be started manually, called by a trusted deploy
workflow, and runs daily at 02:00 UTC.

## Capability traceability

| Capability                              | API evidence                                      | UI evidence                                           | Isolation / cleanup                                | Current evidence                                       |
| --------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Sign-in, sign-out, cookies, enumeration | Exact auth/security contracts                     | Valid/invalid/form/navigation flows                   | Dedicated security identity                        | Passed exact-revision full runtime                      |
| Password reset                          | Invalid/expired-token and enumeration contracts   | Request and validation behavior                       | No mailbox dependency                              | Implemented without delivered-email traversal          |
| Invitations and session invalidation    | Issue/accept/cancel/session contracts             | Public invitation and session behavior                | Dedicated invitee and session identities           | Passed exact-revision full runtime                      |
| Six-role RBAC                           | Exact 401/403 and project scope                   | Role-specific controls/routes                         | Six hard-required identities                       | Passed exact-revision full runtime                      |
| Tests, jobs, monitors                   | Exact CRUD, validation, trigger/run/cancel        | Exact named rows, types and detail state              | Cleanup registry                                   | Passed exact-revision full runtime                      |
| Organizations and projects              | List/create/update/soft-delete and RBAC contracts | Exact org-admin row and UI edit persistence           | Disposable non-default project                     | Passed exact-revision full runtime                      |
| Playwright/k6 execution and locations   | Run/status/cancel/isolation                       | Run visibility and metadata                           | Worker and location environment                    | Passed exact-revision full runtime                      |
| Requirements                            | CRUD, auth and coverage metadata                  | Create/edit/reload/delete                             | Exact requirement cleanup                          | Implemented                                            |
| Dashboard and playground                | Exact resource totals and saved test              | Metric cards, Monaco, templates, errors               | Exact seeded resources                             | Implemented                                            |
| Notification providers                  | CRUD, redaction, validation, SSRF, auth           | Exact channel persistence                             | Provider cleanup                                   | Implemented without external delivery                  |
| Status pages/components/incidents       | Page contracts, RSS and iCal                      | Page/component/incident/publish lifecycles            | Status-page cascade cleanup                        | Implemented                                            |
| Status subscribers and delivery         | Public/admin endpoint contracts                    | Subscriber management surfaces                        | Status-page cascade                                | Delivery intentionally excluded without mailbox        |
| CLI tokens, variables, secrets          | One-time token, scope, decrypt/redaction          | Relevant settings persistence                         | Exact revocation/deletion                          | Implemented                                            |
| Recorder                                | One-time extension credential and revocation      | Missing-extension guidance                            | Credential cleanup                                 | Web contract implemented; extension runtime excluded   |
| Billing, admin, audit                   | Role and settings contracts                       | Owner/admin surfaces                                  | Dedicated owner/super-admin identities             | Core contracts passed; Polar checkout excluded         |
| AI SRE services                         | Project-scoped list and lifecycle                 | Create/edit/detail/archive                            | Disposable project cascade                         | Passed exact-revision full runtime                      |
| AI SRE incidents, brief, investigation  | Alert promotion and stored run state              | Signal promotion plus incident/brief/run persistence  | Soft-deleted isolated project and resource cleanup | Passed exact-revision full runtime                      |
| Copilot                                 | Auth/origin/scoped-request validation             | Prompt/history/archive/stop/mobile/starters/input bounds/live-source opt-in | Read-only prompts and isolated incident            | Passed exact-revision full runtime                      |
| Investigation Map                       | Authenticated project-scoped graph                | Empty-state rendering and navigation surface          | Authenticated project                              | Passed exact-revision full runtime                      |
| Connectors                              | Catalog/setup and authorization contracts         | Exact implemented catalog                             | No third-party dependency                          | Covered without live external searches                 |
| Private Agent                           | Registration exchange/replay/heartbeat/revocation | Register/status/rotate/disable                        | Disposable project cascade                         | Management lifecycle covered; runner lab excluded      |
| Diagnostic recipes                      | Setup contracts                                   | Create/reject/disable lifecycle                        | Isolated recipe data                               | Passed exact-revision full runtime                      |
| Service topology                        | Service lifecycle and map persistence             | Dependency lifecycle and map persistence              | Soft-deleted isolated project                      | Passed exact-revision full runtime                      |

## Workflow and gate

`e2e-full.yml` is the only E2E workflow. It runs the complete deterministic
Chromium suite from `playwright.config.ts`, requires every test identity, rejects
priority skips, verifies the exact deployed build SHA, uploads failure artifacts,
and runs daily or on demand.

## Merge-gate contract

1. PR validation typechecks and discovers the E2E suite without secrets.
2. A trusted preview deployment must expose the exact PR SHA in `/api/health`.
3. Protected-environment workflows run critical API/UI coverage against that
   preview. Never use `pull_request_target` to execute untrusted PR code with
   secrets.
4. Main/staging runs the same complete suite with every required identity.

`e2e-full.yml` provides scheduled, manual, and reusable exact-revision execution.
A repository-owned preview deployment caller is still required before PR E2E
can be claimed as a merge-blocking gate.

## Open implementation and environment gaps

These are not counted as covered and must remain visible until executable:

- Investigation report snapshot/feedback controls have component coverage. Full
  browser acceptance remains in `AI_SRE_TESTING_RUNBOOK.md` section 3.2.
- Delivered-email traversal, third-party webhook delivery, live external
  connector queries, Polar checkout, Recorder-extension transfer, and a real
  Private Agent runner are intentionally excluded from this deterministic suite.
- A trusted preview deployment workflow must invoke the reusable exact-SHA gates
  before these tests can block PR merges safely.

## Completion rule

Do not label Supercheck E2E coverage complete or 100% while any row or profile
above is partial, pending, or lacks an exact-revision run. Test count alone is
never completion evidence.

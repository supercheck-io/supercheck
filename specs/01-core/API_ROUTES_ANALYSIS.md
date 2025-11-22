# API Routes – Current Inventory & Notes

This document reflects the **actual Next.js App Router handlers** that exist under `app/src/app/api` as of this review. It replaces earlier forward-looking drafts and keeps the list aligned with the code that currently ships.

## Snapshot
- ~87 route handlers, all in the App Router
- Authentication via Better Auth (`/api/auth/[...all]` and `/api/auth`)
- Most routes expect an authenticated session; explicit public routes are `health`, status-page assets, and invite acceptance
- Execution features cover Playwright, k6, monitors, status pages, AI-powered fixes, and admin controls

## Route Inventory (by area)

### Authentication & Session
| Route | Purpose |
| --- | --- |
| `/api/auth/[...all]`, `/api/auth` | Better Auth handlers (sign-in, sign-up, reset-password, session) |
| `/api/auth/sign-in/email`, `/api/auth/sign-up/email` | Email/password helpers used by the auth pages |
| `/api/auth/user`, `/api/auth/impersonation-status` | Session details and admin impersonation status |
| `/api/auth/setup-defaults` | Initial org/project/bootstrap |
| `/api/auth/verify-key` | Verify API key validity (job-scoped keys) |
| `/api/auth/error` | Better Auth error surface |
| `/api/invite/[token]` | Accept org invitations |

### Administration & Platform Ops
| Route | Purpose |
| --- | --- |
| `/api/admin/check`, `/api/admin/stats` | AuthZ check + platform stats |
| `/api/admin/users`, `/api/admin/users/[id]`, `/api/admin/users/[id]/organizations` | Super-admin user management & org access |
| `/api/admin/organizations`, `/api/admin/organizations/[id]` | Organization oversight |
| `/api/admin/stop-impersonation` | End admin impersonation |
| `/api/admin/playground-cleanup` | Reset playground data |
| `/api/admin/scheduler/init`, `/api/admin/scheduler/status` | Scheduler health + init |
| `/api/admin/queues/[[...path]]` | Bull Board UI proxy for all queues (includes k6 queues) |

### Organizations, Projects, Variables
| Route | Purpose |
| --- | --- |
| `/api/organizations`, `/api/organizations/[id]`, `/api/organizations/current` | Org CRUD and active org |
| `/api/organizations/members`, `/api/organizations/members/[memberId]`, `/api/organizations/members/invite` | Org membership + invites |
| `/api/organizations/invitations` | Invitation management |
| `/api/organizations/stats` | Org-level stats |
| `/api/projects`, `/api/projects/[id]` | Project CRUD |
| `/api/projects/switch` | Set active project |
| `/api/projects/members/[userId]` | Project membership |
| `/api/projects/[id]/members` | List/update project members |
| `/api/projects/[id]/variables` (+ `/[variableId]`, `/[variableId]/decrypt`) | Project variables (with decrypt view) |
| `/api/locations` | Location metadata for executions/monitors |

### Tests, Jobs, Runs
| Route | Purpose |
| --- | --- |
| `/api/tests`, `/api/tests/[id]`, `/api/tests/[id]/tags` | Test CRUD + tags |
| `/api/tests/[id]/execute` | Execute a saved test (Playwright or k6) |
| `/api/test` | Ad-hoc test execution (playground) |
| `/api/jobs`, `/api/jobs/[id]` | Job CRUD |
| `/api/jobs/[id]/trigger` | Trigger a job run |
| `/api/jobs/run` | Execute a job with provided payload |
| `/api/jobs/status/running` | List currently running jobs |
| `/api/jobs/[id]/api-keys`, `/api/jobs/[id]/api-keys/[keyId]` | Job-scoped API keys |
| `/api/runs`, `/api/runs/[runId]` | Run metadata |
| `/api/runs/[runId]/status`, `/api/runs/[runId]/permissions`, `/api/runs/[runId]/stream` | Status/permissions/console streaming |
| `/api/job-status/events`, `/api/job-status/events/[runId]` | SSE for job run progress |
| `/api/test-status/events/[testId]` | SSE for single test progress |

### Monitoring, Status Pages, Notifications
| Route | Purpose |
| --- | --- |
| `/api/monitors`, `/api/monitors/[id]` | Monitor CRUD |
| `/api/monitors/[id]/status`, `/api/monitors/[id]/results`, `/api/monitors/[id]/location-stats` | Monitor status/results |
| `/api/monitors/[id]/notifications`, `/api/monitors/[id]/permissions` | Notification + RBAC settings |
| `/api/status-pages/check`, `/api/status-pages/[id]/rss`, `/api/status-pages/[id]/upload` | Public status pages + asset upload |
| `/api/alerts/history` | Alert history |
| `/api/notification-providers`, `/api/notification-providers/[id]`, `/api/notification-providers/[id]/usage`, `/api/notification-providers/test` | Channel configuration + test send |
| `/api/assets/[...path]` | Public asset proxy (status page uploads, favicons) |

### AI, Validation, k6 & Utilities
| Route | Purpose |
| --- | --- |
| `/api/ai/create-test`, `/api/ai/fix-test`, `/api/ai/fix-test-stream` | AI helpers for authoring/fixing tests |
| `/api/validate-script` | Validates Playwright/k6 scripts |
| `/api/k6/runs/[runId]` | Retrieve k6 performance run details |
| `/api/dashboard` | Dashboard aggregates (scoped to active project) |
| `/api/queue-stats/sse` | SSE with queue stats |
| `/api/health` | Liveness/health probe |
| `/api/test-results/[...path]`, `/api/assets/[...path]` | Report and asset proxying from S3/MinIO |
| `/api/audit` | Audit log viewer (org-scoped) |
| `/api/tags`, `/api/tags/[id]` | Global tag management |

## Notes & Alignment
- There is **no** `/api/heartbeat` endpoint, and no `/api/jobs/[id]/run` alias; triggers use `/api/jobs/[id]/trigger` or `/api/jobs/run`.
- Password reset is handled by Better Auth inside the catch-all handler; there are no standalone `forget-password` or `reset-password` route files.
- Real-time updates use SSE: `/api/queue-stats/sse`, `/api/job-status/events`, `/api/job-status/events/[runId]`, `/api/runs/[runId]/stream`, and `/api/test-status/events/[testId]`.
- K6 performance runs surface through `/api/k6/runs/[runId]`; k6 execution is otherwise triggered via the standard job/test execution routes.
- Health check exists at `/api/health`; consider expanding it to check DB, Redis, and MinIO connectivity.
- Notification surfaces (read-only run and monitor views) inherit org membership checks before rendering data.

## Improvement Backlog (code-aligned)
- ✅ **AuthZ coverage:** Job API key routes and report proxy now enforce org/project RBAC before returning data.
- ✅ **Streaming safeguards:** `/api/job-status/events/[runId]` now requires active project context and org match before streaming.
- **Caching:** Dashboard endpoint is compute-heavy; add short-lived caching keyed by project/org to reduce DB load.
- **Monitoring queries:** Monitor list still does multiple queries per monitor for status in `app/src/app/api/monitors/[id]/status/route.ts`; push aggregation into a single query to avoid N+1 patterns.

_Last verified against code: current workspace state_

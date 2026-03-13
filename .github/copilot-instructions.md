# Copilot Instructions for SuperCheck

## Development Commands

```bash
# App (/app)
npm run dev
npm run build
npm run lint
npm test
npm test -- src/lib/capacity-manager.spec.ts        # single Jest file
npm run e2e
npm run e2e -- tests/jobs/jobs.spec.ts              # single Playwright file
npm run e2e -- --grep "creates a job"               # single Playwright test by title
npm run db:generate
npm run db:migrate
npm run db:studio

# Worker (/worker)
npm run dev
npm run build
npm run lint
npm test
npm test -- src/execution/processors/playwright-execution.processor.spec.ts

# Docs site (/docs)
npm run dev
npm run build
npm run lint
npm run generate-docs
```

## High-Level Architecture

- Supercheck is split into three runnable apps:
  - `/app`: Next.js frontend + API
  - `/worker`: NestJS BullMQ workers for Playwright, k6, and monitor execution
  - `/docs`: Next.js docs site
- Execution flow is: UI/API request -> App API route creates/updates DB run rows -> App enqueues BullMQ jobs in Redis -> Worker processors execute and update statuses/artifacts -> results are stored in Postgres + S3/MinIO.
- Queue topology is intentionally mixed:
  - Playwright: single global queue (`playwright-global`)
  - k6: global queue (`k6-global`) plus per-location queues (e.g., `k6-local`, `k6-us-east`) — dynamically created from `locations` DB table
  - Monitor: per-location queues only (e.g., `monitor-local`, `monitor-us-east`) — dynamically created from `locations` DB table
- Worker location routing is controlled by `WORKER_LOCATION` in `/worker/src/k6/k6.module.ts` and `/worker/src/monitor/monitor.module.ts`.
- Scheduling now runs in the App side (see worker `AppModule` comment: scheduler module removed from worker).

## Key Conventions

### Multi-tenant scoping is mandatory
- In App APIs and actions, scope reads/writes by both `projectId` and `organizationId` (example patterns in `/app/src/app/api/jobs/run/route.ts` and `/app/src/actions/*.ts`).
- Prefer `requireAuthContext()` for API routes and `requireProjectContext()` for server actions.

### Server action pattern
- Server actions live in `/app/src/actions` and use `"use server"` at the top.
- Typical shape is explicit typed response objects with `success` and optional `error`.
- Pair permission checks (`checkPermissionWithContext`) with context from `requireProjectContext`.

### DB/schema pattern
- Drizzle schema source of truth is `/app/src/db/schema`.
- Define Zod schemas with Drizzle tables using `createInsertSchema` / `createSelectSchema`.
- Export shared schema from `/app/src/db/schema/index.ts`.

### RBAC split: client-safe vs server-only
- Use `/app/src/lib/rbac/permissions-client.ts` in client code.
- `/app/src/lib/rbac/permissions.ts` integrates Better Auth (`createAccessControl`) and is server-only.

### Queue constants must stay aligned
- Queue names are dynamically generated from the `locations` database table (format: `k6-{code}`, `monitor-{code}`).
- **Use the queue name builder functions** from `/app/src/lib/queue.ts` instead of inline template strings:
  - `PLAYWRIGHT_QUEUE` (`"playwright-global"`)
  - `K6_GLOBAL_QUEUE` (`"k6-global"`)
  - `k6QueueName(locationCode)` → `"k6-{code}"`
  - `monitorQueueName(locationCode)` → `"monitor-{code}"`
- The fixed queue names (scheduler queues) must stay synchronized between:
  - `/app/src/lib/queue.ts`
  - `/worker/src/execution/constants.ts`
  - `/worker/src/k6/k6.constants.ts`
  - `/worker/src/monitor/monitor.constants.ts`
- Do not rename queue constants in one place only.
- After any location CRUD, call `invalidateLocationCache()`, `invalidateQueueMaps()`, `invalidateQueueEventHub()`, and `invalidateBullBoard()` (from `@/lib/bull-board/state`).

### Execution and scaling behavior
- Per-process concurrency is intentionally low/hardcoded (`@Processor(..., { concurrency: 1 })`, plus `MAX_CONCURRENT_EXECUTIONS: 1` in worker memory constants); scale by running more worker replicas.
- `SELF_HOSTED === "true"` gates behavior in AI/security flows (`/app/src/lib/ai/*`).
- **Docker vs local dev paths**: `ContainerExecutorService` exposes `resolveWorkerDir()` (`/worker` in Docker, `process.cwd()` locally) and `resolveBrowsersPath()` (`/ms-playwright` in Docker, `undefined` locally). Use these instead of hardcoding Docker paths.

### E2E auth convention
- E2E tests use `loginIfNeeded()` in each test file's `beforeEach` (see `/app/e2e/playwright.config.ts` and `/app/e2e/tests/**`); no shared Playwright storage-state auth file.

## Repository Notes

- `README.md` is the primary product/architecture overview for this monorepo.
- `CONTRIBUTING.md` currently states that external contributions are not being accepted.

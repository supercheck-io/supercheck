# Supercheck review rules

The custom reviewer selects complete sections by their `Paths:` globs from the
trusted default-branch checkout. CodeRabbit also consumes this file.

## Evidence and scope
Paths: **/*
- Review concrete bugs introduced by this change. Establish the failure scenario from supplied code; do not ask maintainers to verify guesses.
- Skip formatting, naming, generic cleanup, and findings fully covered by lint or type checking. A CI check does not excuse a runtime or security defect.
- Lockfile and version updates can contain real compatibility or security problems. Report them only with supplied evidence, never because a digest or upstream API cannot be verified from a diff.
- Treat recorder/playwright/** as vendored upstream code. Generated app/public/*.d.ts and playwright-types.json are excluded from custom review; review their generators when changed.
- Release publication is a maintainer operation. Do not recommend creating tags or publishing releases as review findings.
- Do not infer missing tests or callers from their absence in a diff. An empty findings list is valid.

## Tenant isolation and authorization
Paths: app/src/app/api/**, app/src/actions/**, app/src/db/**
- Project-owned reads and writes must enforce organizationId and projectId, directly or through a verified scoped helper. Organization-level and global resources have different scopes; do not demand projectId for them.
- API routes prefer requireAuthContext(); server actions prefer requireProjectContext() and checkPermissionWithContext(). Report an authorization bypass, not merely a different helper name.

## Client and server imports
Paths: app/src/**, worker/src/**
- Client code uses app/src/lib/rbac/permissions-client.ts. permissions.ts integrates Better Auth and is server-only; trace supplied imports before reporting a boundary violation.
- Preserve dynamic import boundaries for ESM-only Better Auth in CommonJS code where applicable.

## Queue and location lifecycle
Paths: app/src/lib/**, app/src/actions/**, app/src/app/api/**, worker/src/**
- Preserve shared queue naming across app/src/lib/queue.ts and worker/src/execution/constants.ts, worker/src/k6/k6.constants.ts, worker/src/monitor/monitor.constants.ts. Use k6QueueName() and monitorQueueName() where available. Do not claim a mismatch without both sides in the supplied code.
- Location CRUD must invalidate affected location caches, queue maps, QueueEventHub, and Bull Board via invalidateLocationCache(), invalidateQueueMaps(), invalidateQueueEventHub(), and invalidateBullBoard(), including indirect calls through shared helpers.
- QueueEvents needs a dedicated blocking connection. In the app pass Redis options so BullMQ owns that connection; passing an untracked external duplicate can leak because BullMQ duplicates it again.
- Per-process worker concurrency of one is intentional; scale with replicas. Do not suggest raising it without evidence of a defect.

## Data and execution contracts
Paths: app/src/db/**, app/src/lib/**, worker/src/**
- Drizzle schemas are defined in app/src/db/schema with associated insert/select Zod schemas and shared exports. Parameterized SQL and SQL migrations are legitimate; flag unsafe interpolation or a demonstrated schema contract mismatch.
- Preserve Docker and local execution paths through resolveWorkerDir() and resolveBrowsersPath() where applicable.
- Preserve SELF_HOSTED === "true" behavior in AI and security flows. Report a demonstrated bypass or regression, not a missing gate on unrelated code.

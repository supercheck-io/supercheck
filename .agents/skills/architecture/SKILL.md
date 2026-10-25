---
name: supercheck-architecture
description: Work on Supercheck system architecture, Next.js routes and actions, React data hooks and query keys, Drizzle schemas, tables, columns, indexes and migrations, app-worker boundaries, or cross-package contracts.
---

# Supercheck architecture

Supercheck is a multi-tenant testing, monitoring, and reliability platform. The repository contains a Next.js application, NestJS execution worker, CLI, browser recorder, documentation, and self-hosted deployment assets.

```mermaid
flowchart LR
  UI[Next.js UI] --> API[Routes and server actions]
  CLI[CLI] --> API
  REC[Recorder extension] --> API
  API --> AUTH[Better Auth and RBAC]
  AUTH --> DB[(PostgreSQL and Drizzle)]
  API --> Q[(Redis and BullMQ)]
  Q --> WORKER[NestJS worker]
  WORKER --> JOB[gVisor execution Job]
  WORKER --> OBJ[(S3 or RustFS)]
```

## Repository map

| Path | Responsibility |
|---|---|
| `app/src/app` | Next.js 16 App Router pages and route handlers |
| `app/src/actions` | Server-side UI mutations |
| `app/src/components` | Feature and shared React components |
| `app/src/hooks` | React Query data access and cache contracts |
| `app/src/db/schema` | Drizzle schema definitions |
| `app/src/db/migrations` | PostgreSQL migration history |
| `app/src/lib` | Auth, RBAC, queues, schedulers, validation, security, billing, and SRE services |
| `app/src/sre` | AI SRE agents, tools, skills, evaluation, and orchestration |
| `worker/src` | NestJS execution, monitor, notification, and private-agent workers |
| `worker/src/monitor-control` | Separate NestJS entrypoint (`main.ts`) for durable monitor check cycles |
| `worker/src/queue-alerting` | Queue health alerting |
| `cli` | `@supercheck/cli` monitoring-as-code client |
| `recorder` | Apache-licensed Playwright CRX recorder and browser extension |
| `docs` | Public Fumadocs site |
| `deploy/docker` | Public Docker Compose and self-hosted assets |

## Start here

| File | Why |
|---|---|
| `app/src/db/schema/index.ts`, `app/src/db/schema/types.ts` | Schema barrel and shared JSON column types |
| `app/src/db/migrations/`, `app/drizzle.config.ts` | Migration history and generator config |
| `app/src/lib/queue.ts` | Queue names, payload types, and Redis connections for every BullMQ queue |
| `app/src/lib/auth-context.ts`, `app/src/lib/rbac/` | Identity, tenant context, and permission checks (see `supercheck-security-auth`) |
| `worker/src/app.module.ts` | Worker module wiring |

## Request and data boundaries

```mermaid
flowchart TD
  PAGE[Page or client component] --> HOOK[React Query hook]
  HOOK --> ROUTE[Route handler]
  PAGE --> ACTION[Server action]
  ROUTE --> CTX[Authentication and tenant context]
  ACTION --> CTX
  CTX --> RBAC[Resource/action authorization]
  RBAC --> VALIDATE[Zod validation]
  VALIDATE --> SERVICE[Business logic]
  SERVICE --> DB[(Drizzle)]
  SERVICE --> QUEUE[BullMQ]
```

- Prefer Server Components until browser state, effects, or event handlers require `"use client"`.
- Keep business rules below transport and UI layers. Routes/actions translate auth, input, status codes, and public errors.
- Use bearer-compatible auth helpers for routes called by CLI/API keys (`requireAuthContext` and `hasPermissionForUser`); cookie-only helpers such as `hasPermission` break those callers.
- Validate request bodies, params, search params, uploads, provider events, and browser messages at their trust boundary.
- Reject malformed UUID route params before any database access (`isUuid` in `app/src/lib/uuid.ts`; regression suite `app/src/app/api/malformed-identifiers.spec.ts`).
- Use the owning schema to determine scope. Organization-owned resources need organization scoping; project-owned resources need verified organization and project ownership. Do not mechanically add both IDs to tables that do not own both.

## Database and migration rules

- PostgreSQL 18+ and Drizzle ORM are current (the schema relies on the PostgreSQL 18-native `uuidv7()`). Do not introduce Prisma, MySQL assumptions, or NextAuth patterns.
- Follow neighboring schema conventions for UUIDs, timestamps, indexes, foreign keys, uniqueness, and delete behavior.
- Add indexes for real filters, joins, ordering, and uniqueness—not as a template exercise.
- Generate and inspect migrations. New non-null columns need safe behavior for existing rows.
- Analyze destructive changes, backfills, transaction duration, locks, rollback/recovery, and rolling app/worker compatibility.
- Keep app and worker schema representations compatible where both packages read the same tables. `worker/src/db/schema/` is a separate copy of `app/src/db/schema/` (including `types.ts`): a schema or type change in one package must be mirrored in the other.

## React Query and client data

- Query keys are contracts. Prefetch (`app/src/lib/prefetch-utils.ts`), hooks (`app/src/hooks/`), invalidation, and parameter object shapes must match exactly. Hooks export `*_QUERY_KEY` constants and append scope (`[...KEY, projectId]`); cached data must also be isolated per project and account.
- Render cached query data directly. Do not mirror it into component state using an effect unless editing semantics require a deliberate snapshot.
- Preserve current freshness/refetch behavior when changing hooks; do not remove `refetchOnMount` or cache settings without tracing UX impact.
- Bound and paginate growing collections. Avoid N+1 requests and per-row database lookups.
- Mutations must invalidate or update every affected cache key and preserve loading, empty, error, and accessibility states.

## Cross-package compatibility

- App and worker deploy independently. Queue names, payloads, status values, retries, and result schemas must tolerate version skew.
- CLI and recorder are public clients. Preserve documented API and output compatibility or provide an explicit migration/version strategy.
- Cloud and self-hosted behavior must remain explicit. UI visibility does not substitute for server-side feature, entitlement, or security enforcement.

## Verification

- Trace every changed contract through callers, persistence/queue, consumers, tests, and docs.
- Run checks from each affected package directory.
- Schema changes require migration/schema-contract tests; shared contracts require producer and consumer coverage.
- Distinguish code verification from browser, provider, deployment, billing, and production acceptance.

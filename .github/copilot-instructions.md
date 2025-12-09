# Copilot Instructions for SuperCheck

## Architecture Overview

SuperCheck is a test automation and monitoring platform with two main services:

- **App** (`/app`): Next.js 16 frontend + API using React 19, Better Auth, Drizzle ORM
- **Worker** (`/worker`): NestJS service executing Playwright/k6 tests via BullMQ jobs

Data flows: `User → Next.js API → Redis/BullMQ → Worker → PostgreSQL/MinIO`

## Key Patterns

### Database Operations

- Use Drizzle ORM exclusively. Schemas in `/app/src/db/schema/`, queries in `/app/src/db/queries/`
- Always create Zod schemas alongside tables (`createInsertSchema`, `createSelectSchema`)
- Reference `/docs/specs/01-core/ERD_DIAGRAM.md` for schema relationships

### Server Actions

- Place in `/app/src/actions/` as async functions with `"use server"` directive
- Always validate inputs with Zod before database operations
- Return `{ success, data?, error? }` pattern

### RBAC & Auth

- Roles defined in `/app/src/lib/rbac/permissions-client.ts` (6 levels: super_admin → project_viewer)
- Client components import `Role` from `permissions-client.ts` (never `permissions.ts`)
- `@polar-sh/better-auth` is server-only (uses `node:async_hooks`) - never import in client code

### Self-Hosted vs Cloud

- Check `process.env.SELF_HOSTED === "true"` for feature gating
- Cloud mode requires billing (Polar), email verification, disposable email blocking
- Self-hosted mode: unlimited access, no billing, immediate signup

## Development Commands

```bash
# App (in /app)
npm run dev              # Next.js dev server at localhost:3000
npm run db:generate      # Generate Drizzle migrations
npm run db:migrate       # Apply migrations
npm run db:studio        # Visual database explorer

# E2E Tests (in /app)
npm run e2e              # Run Playwright E2E tests
npm run e2e:ui           # Interactive test runner

# Worker (in /worker)
npm run dev              # NestJS watch mode
npm run build            # Production build
```

## File Location Patterns

| Type                | Location                                     |
| ------------------- | -------------------------------------------- |
| API Routes          | `/app/src/app/api/**/*.ts`                   |
| Server Actions      | `/app/src/actions/*.ts`                      |
| React Components    | `/app/src/components/**/*.tsx`               |
| DB Schemas          | `/app/src/db/schema/*.ts`                    |
| Worker Services     | `/worker/src/{execution,k6,monitor}/**/*.ts` |
| Specs Documentation | `/docs/specs/**/*.md`                        |

## Critical Files to Know

- `/app/src/lib/rbac/permissions-client.ts` - Role enum and permission statements
- `/app/src/db/schema/index.ts` - All database table exports
- `/worker/src/execution/services/` - Test execution logic
- `/docs/specs/` - Always check before implementing new features

## Testing Approach

- Unit tests: Jest (`npm test` in both `/app` and `/worker`)
- E2E tests: Playwright in `/app/e2e/` with page objects in `/app/e2e/pages/`
- Each E2E test uses `loginIfNeeded()` in `beforeEach` - no shared auth state

## Common Gotchas

1. **Better Auth ESM**: It's ESM-only - use dynamic imports if needed in CommonJS contexts
2. **Worker scaling**: `MAX_CONCURRENT_EXECUTIONS=1` is hardcoded; scale via `WORKER_REPLICAS`
3. **S3/MinIO**: Use `S3_FORCE_PATH_STYLE=true` for local MinIO
4. **Multi-tenant**: Always filter queries by `organizationId` and `projectId`

## Spec Documentation

Before modifying core systems, read the relevant spec in `/docs/specs/`:

- Architecture: `01-core/SUPERCHECK_ARCHITECTURE.md`
- Auth flows: `02-authentication/AUTHENTICATION_SYSTEM.md`
- Test execution: `03-execution/EXECUTION_SYSTEM.md`
- Monitoring: `04-monitoring/MONITORING_SYSTEM.md`

Update specs when changing API contracts, DB schema, or auth logic.

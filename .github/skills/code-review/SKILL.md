---
name: code-review
description: "Use when: reviewing code changes (uncommitted, staged, or PR diffs), performing code quality audits, checking for security vulnerabilities, verifying architectural patterns, validating multi-tenant scoping, reviewing test coverage, or when asked to 'review my code' or 'check my changes'. Covers Next.js App Router, NestJS worker, Drizzle ORM, BullMQ queues, RBAC, Zod validation, and all SuperCheck conventions."
---

# SuperCheck Code Review

## Review Workflow

### Step 1: Gather Changes

**Uncommitted changes (staged + unstaged):**
Use the `get_changed_files` tool to retrieve current diffs. If the user specifies, filter by `staged` or `unstaged`.

**Specific files:**
Read the files the user points to and review them in context.

**Branch comparison:**
Run `git diff main...HEAD` or `git log --oneline main..HEAD` in the terminal to see all commits on the current branch vs main.

### Step 2: Classify Each Change

Categorize every modified file:

| Category | File Patterns |
|----------|---------------|
| API Route | `app/src/app/api/**/*.ts` |
| Server Action | `app/src/actions/*.ts` |
| React Component | `app/src/components/**/*.tsx` |
| Database Schema | `app/src/db/schema/*.ts` |
| Database Migration | `app/src/server/db/migrations/**` |
| Validation | `app/src/lib/validations/*.ts` |
| RBAC / Auth | `app/src/lib/rbac/*.ts`, `app/src/lib/auth*.ts` |
| Worker Processor | `worker/src/**/*.processor.ts` |
| Worker Service | `worker/src/**/*.service.ts` |
| Worker Module | `worker/src/**/*.module.ts` |
| Queue Constants | `app/src/lib/queue.ts`, `worker/src/**/constants.ts` |
| Test File | `**/*.spec.ts`, `**/*.spec.tsx`, `e2e/**/*.spec.ts` |
| Docker / Deploy | `deploy/**`, `Dockerfile` |
| Config | `*.config.*`, `tsconfig.json`, `.env*` |

### Step 3: Apply Review Checklist

Run through **every** applicable section below for each changed file. Report findings as:

- **CRITICAL**: Must fix before merge (security, data leak, broken functionality)
- **WARNING**: Should fix (conventions violated, potential bugs, performance)
- **SUGGESTION**: Nice to have (readability, patterns, minor improvements)
- **OK**: Passes review

---

## Review Checklists

### 1. Security (Apply to ALL changes)

#### Multi-Tenant Data Isolation (CRITICAL)
Every database query in API routes and server actions **MUST** scope by both `projectId` AND `organizationId`:

```typescript
// CORRECT
const result = await db.select().from(table).where(
  and(
    eq(table.projectId, projectId),
    eq(table.organizationId, organizationId),
    ...otherFilters
  )
)

// WRONG — missing organizationId scoping
const result = await db.select().from(table).where(
  eq(table.projectId, projectId)
)

// WRONG — no scoping at all
const result = await db.select().from(table).where(
  eq(table.id, id)
)
```

**Check for:**
- Every `db.select()`, `db.update()`, `db.delete()` includes tenant scoping
- No queries that fetch by `id` alone without verifying ownership
- JOIN queries still enforce scoping on the primary table
- Subqueries maintain scoping context

#### Authentication & Authorization
- API routes use `requireUserAuthContext()` or `requireProjectContext()`
- Server actions use `requireProjectContext()` + `requirePermissions()` or `checkPermissionWithContext()`
- Permission checks happen BEFORE any data mutation
- No auth bypass paths (early returns, catch blocks that skip auth)
- API key routes validate scopes match the operation
- `isAuthError()` properly caught and returns 401 (not 500)

#### Input Validation
- All user inputs validated with Zod schemas before use
- `.parse()` called (throws on invalid) — not `.safeParse()` when errors should halt execution
- No raw `request.body` or `request.query` used without validation
- File uploads validate size AND MIME type
- URL/path parameters validated (especially UUIDs)
- No user input interpolated into SQL (use Drizzle parameterized queries)
- No user input in shell commands (check `execa` calls in worker)
- No user input rendered as raw HTML (XSS)

#### Secrets & Sensitive Data
- No hardcoded secrets, API keys, or passwords
- Secrets use `encryptValue()` / `decryptValue()` with project-scoped context
- List APIs return `[ENCRYPTED]` for secret fields, not the actual value
- No secrets logged (check `console.log`, `console.error`, `this.logger.*`)
- Environment variables accessed via `process.env`, never committed
- Error messages don't expose internal details (stack traces, DB errors, file paths)

#### SSRF / Network
- No user-controlled URLs passed to `fetch()` or HTTP clients without allowlist validation
- Worker execution pods block RFC1918, metadata endpoints, K8s API (verify NetworkPolicy if changed)

### 2. API Routes (`app/src/app/api/**`)

#### Structure
```typescript
// Expected pattern:
export async function METHOD(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, organizationId } = await requireUserAuthContext()
    // OR for project-scoped:
    const { userId, project, organizationId } = await requireProjectContext()

    // Permission check
    const allowed = await hasPermissionForUser(userId, "resource", "action", { organizationId })
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Validate input
    const body = schema.parse(await request.json())

    // Business logic (scoped queries)
    // ...

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: "..." }, { status: 401 })
    console.error("[ROUTE_NAME] Error:", error)
    return NextResponse.json({ error: "..." }, { status: 500 })
  }
}
```

**Check for:**
- Response format consistency: `{ success, data, error }`
- Proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- `isAuthError()` and `isProjectConfigError()` handled distinctly
- No uncaught promise rejections
- `params` properly awaited (Next.js App Router pattern: `const { id } = await params`)
- Rate limiting on public endpoints

### 3. Server Actions (`app/src/actions/*.ts`)

#### Structure
```typescript
"use server"

export async function actionName(data: ValidatedType) {
  try {
    const { userId, project, organizationId } = await requireProjectContext()
    await requirePermissions({ resource: ["action"] })

    const validated = schema.parse(data)

    // Scoped DB operations
    // ...

    await logAuditEvent({ action: "...", resourceId: "..." })
    revalidatePath("/relevant-path")

    return { success: true, message: "Done" }
  } catch (error) {
    console.error("[ACTION_NAME] Failed:", error)
    return { success: false, error: "Operation failed" }
  }
}
```

**Check for:**
- `"use server"` directive at top of file
- Return type: `{ success: boolean, message?: string, error?: string }`
- Never throws to client — always returns error object
- `revalidatePath()` or `revalidateTag()` called after mutations
- Audit logging via `logAuditEvent()` for all mutations
- Console logging with `[OPERATION_NAME]` prefix
- Permission check inside try/catch (return `{ success: false }`, don't throw)

### 4. Database Schema (`app/src/db/schema/*.ts`)

**Check for:**
- UUIDs use `$defaultFn(() => sql\`uuidv7()\`)` for time-ordered IDs
- Foreign keys have proper `references()` with `onDelete` cascading
- Indexes on foreign keys and frequently-filtered columns
- Unique constraints where business logic requires uniqueness
- `notNull()` on required fields
- `timestamp` fields for `createdAt`/`updatedAt`
- Zod schemas created: `createInsertSchema()`, `createSelectSchema()`
- Schema exported from `app/src/db/schema/index.ts`
- Migration generated (`npm run db:generate`) — migration file should be present if schema changed

### 5. Database Migrations

**Check for:**
- Migration matches schema changes exactly
- No data-destructive operations without explicit user confirmation
- `DROP TABLE`, `DROP COLUMN` reviewed carefully
- Index naming is consistent
- Default values for new NOT NULL columns on existing tables
- Migration is idempotent (safe to re-run)

### 6. React Components (`app/src/components/**`)

**Check for:**
- Client vs Server component boundary correct (`"use client"` only when needed)
- No server-only imports in client components (e.g., `db`, `requireProjectContext`)
- RBAC checks: use `permissions-client.ts` on client, `permissions.ts` on server
- Form submissions via server actions, not direct API calls
- Loading/error states handled
- No inline styles where Tailwind classes exist
- Accessible: proper ARIA attributes, keyboard navigation
- No `dangerouslySetInnerHTML` with user content
- React Hook Form + Zod resolver for forms

### 7. Worker Services (`worker/src/**`)

#### NestJS Patterns
- Services use `@Injectable()` decorator
- Dependencies injected via constructor
- Logger: `private readonly logger = new Logger(ServiceName.name)`
- Structured logging: `this.logger.log()`, `.warn()`, `.error()` — not `console.log`

#### Processor Patterns
- `@Processor(QUEUE_NAME, { concurrency: 1 })` — concurrency stays at 1
- Job data properly typed
- Error handling: catch, log, and let BullMQ handle retries
- No blocking operations in hot paths
- Timeouts set on external operations

#### Container Execution
- Use `resolveWorkerDir()` and `resolveBrowsersPath()` — not hardcoded Docker paths
- `SELF_HOSTED === "true"` gates checked correctly (string comparison)
- K8s client uses projected token auth (not static tokens)

### 8. Queue Constants

**CRITICAL**: Queue names must stay synchronized across:
- `app/src/lib/queue.ts` (source of truth)
- `worker/src/execution/constants.ts`
- `worker/src/k6/k6.constants.ts`
- `worker/src/monitor/monitor.constants.ts`

**Check for:**
- Use queue name builder functions (`PLAYWRIGHT_QUEUE`, `K6_GLOBAL_QUEUE`, `k6QueueName()`, `monitorQueueName()`)
- No inline template strings for queue names
- After location CRUD: `invalidateLocationCache()`, `invalidateQueueMaps()`, `invalidateQueueEventHub()`, `invalidateBullBoard()` called
- Queue name not renamed in one place only

### 9. Testing

#### Unit Tests (`*.spec.ts`)
**Check for:**
- Tests exist for new logic (especially utils, services, validators)
- Mocks set up BEFORE imports (`jest.mock()` hoisting)
- `jest.clearAllMocks()` in `beforeEach()`
- Descriptive test names: `should [expected behavior] when [condition]`
- Both happy path and error/edge cases covered
- No test-only state leaking between tests
- Assertions are specific (not just `toBeTruthy()`)
- Mock return values match actual types

#### E2E Tests (`e2e/**/*.spec.ts`)
**Check for:**
- `loginIfNeeded()` in `beforeEach()`
- No shared Playwright storage-state auth
- Tests are independent (no ordering dependency)
- Proper selectors (data-testid preferred over CSS classes)

### 10. TypeScript Quality

**Check for:**
- No `any` types (use `unknown` + type narrowing)
- No `@ts-ignore` or `@ts-expect-error` without documented reason
- Proper type inference (avoid redundant type annotations)
- Discriminated unions for state management
- Zod `.infer<>` for schema-derived types
- Strict null checks respected (no `!` non-null assertions without justification)
- Enums from `permissions-client.ts` for roles (DRY)

### 11. Error Handling

**Check for:**
- No silent catch blocks (`catch (e) { /* empty */ }`)
- Error context included in log messages
- Errors don't expose internals to users
- Async errors properly propagated or handled
- Worker: structured logging with Pino, not console
- Actions: return `{ success: false, error }` — never throw to client

### 12. Performance

**Check for:**
- No N+1 query patterns (use JOINs or batch queries)
- Large result sets paginated
- Database indexes for new WHERE/ORDER BY columns
- No unnecessary `await` in loops (use `Promise.all` for independent operations)
- Redis caching used where appropriate
- No blocking operations in request handlers
- `select()` specific columns, not `select(*)` for large tables

### 13. Self-Hosted vs Cloud

**Check for:**
- `SELF_HOSTED` checks use string comparison: `=== "true"` or `=== "1"`
- Feature gates don't break in either mode
- Billing/Polar code guarded by `!isSelfHosted()`
- Email verification skipped in self-hosted
- CAPTCHA disabled in self-hosted
- New features work in both modes unless explicitly scoped

### 14. Docker & Deployment (`deploy/**`)

**Check for:**
- Image version bumped in ALL compose files (see version bump checklist)
- Environment variables documented
- No secrets in Dockerfiles or compose files
- Health check endpoints exist for new services
- Resource limits set appropriately
- `docker-compose-local.yml` NOT versioned (builds from source)

---

## Review Output Format

Structure your review as:

```markdown
## Code Review Summary

**Files Reviewed:** [count]
**Scope:** [uncommitted/staged/branch/specific files]

### Critical Issues (must fix)
1. **[FILE:LINE]** — [Description of issue]
   - Why: [Security/correctness impact]
   - Fix: [Specific recommendation]

### Warnings (should fix)
1. **[FILE:LINE]** — [Description]
   - Fix: [Recommendation]

### Suggestions (nice to have)
1. **[FILE:LINE]** — [Description]

### Passed Checks
- [x] Multi-tenant scoping verified
- [x] Auth/RBAC checks present
- [x] Input validation with Zod
- [x] No secrets exposed
- [x] Tests updated
- [ ] Missing: [specific check that wasn't applicable]

### Summary
[1-3 sentence overall assessment]
```

---

## Common Anti-Patterns to Flag

| Anti-Pattern | Example | Fix |
|-------------|---------|-----|
| Missing tenant scoping | `db.select().from(t).where(eq(t.id, id))` | Add `and(eq(projectId), eq(organizationId))` |
| Auth after data access | Fetching data, THEN checking permission | Move auth check to top |
| Swallowed errors | `catch (e) {}` or `catch (e) { return }` | Log error, return error object |
| Raw user input | `const q = req.query.search` used directly | Validate with Zod first |
| `any` type escape | `const data: any = ...` | Use proper type or `unknown` |
| Console.log in worker | `console.log("processing")` | Use `this.logger.log()` |
| Inline queue names | `` `k6-${location}` `` | Use `k6QueueName(location)` |
| Non-null assertion | `user!.id` | Null check or early return |
| Secret in logs | `logger.log("Token:", apiKey)` | Remove sensitive values from logs |
| Missing revalidation | Server action mutates but no `revalidatePath` | Add appropriate revalidation |
| Throwing from action | `throw new Error("fail")` in server action | Return `{ success: false, error }` |
| Missing migration | Schema changed but no migration file | Run `npm run db:generate` |
| Hardcoded Docker path | `"/worker/reports"` | Use `resolveWorkerDir()` |
| Client importing server code | `import { db } from "@/db"` in `"use client"` component | Move to server action/route |

---

## Quick Commands Reference

```bash
# App
npm run lint                    # ESLint check
npm run build                   # Type check + build
npm test                        # Jest unit tests
npm run e2e                     # Playwright E2E

# Worker
npm run lint                    # ESLint check
npm run build                   # Type check + build
npm test                        # Jest unit tests

# Database
npm run db:generate             # Generate migration from schema changes
npm run db:migrate              # Apply pending migrations
```

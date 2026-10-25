# AGENTS.md - Development Guidelines for Supercheck

Instructions for coding agents working in this repository. Domain detail lives in `.agents/skills/` (also linked from `.claude/skills/`); load the skill matching the area you change.

## Temporary files

- Never create or keep temporary files in either the `supercheck` or `supercheck-ops` repository, even if ignored by Git. Use the operating system temporary directory (for example, `mktemp -d`) for scratch notes, ad hoc reports, logs, patches, downloads, and command output.
- Keep reusable plans and handoffs in Tally scratchpads. Only add documentation intended to be maintained as part of the project.
- Before committing or opening a PR, inspect `git status` and the staged diff; never include temporary artifacts. Remove only temporary files created by the current task, and preserve other people's work.

## Quality gate (run before finishing)

Run the checks for the packages you changed and fix everything they report. They are a fast subset of CI (`.github/workflows/pr-validation.yml`, CONTRIBUTING.md "Checks"); a change is not done until the relevant checks pass.

```bash
# App (from app/)
npx tsc --noEmit                       # if route types are stale, run `npx next typegen` first
npm run lint                           # eslint . --max-warnings 0
npm test                               # Jest unit tests (excludes *.db.spec.ts)
# When you change a *.db.spec.ts or the queries it covers (needs Postgres + TEST_DATABASE_URL):
npm run test:db

# Worker (from worker/)
npx tsc --noEmit
npm run lint:check                     # CI-equivalent; `npm run lint` auto-fixes
npm test

# CLI (from cli/)
npm run typecheck && npm run lint && npm test

# E2E suite (from app/e2e/)
npx tsc --noEmit -p tsconfig.json
```

Fix the root cause of any failure; never silence it with `eslint-disable`, `@ts-ignore`, `any`, or by skipping tests. In Claude Code, `/check` runs the always-on checks above for changed packages (not `test:db`).

### Running single tests

```bash
npm test -- path/to/file.spec.ts                 # from app/ or worker/
npm test -- --testNamePattern="specific test"
npm run e2e -- tests/auth/rbac.spec.ts           # from app/ (runs in app/e2e)
```

## Local development (hybrid mode)

Docker Compose runs the full stack (`deploy/docker/docker-compose-local.yml`), but for faster iteration on the app or worker you can run them from source against the same Postgres, Redis, and RustFS containers. The Compose file publishes those services on `127.0.0.1`; if a default host port is already taken, remap it with `DB_HOST_PORT`/`REDIS_HOST_PORT` in `deploy/docker/.env` and use the same port in `app/.env` and `worker/.env`.

```bash
cd deploy/docker
docker compose -f docker-compose-local.yml up -d postgres redis rustfs
docker compose -f docker-compose-local.yml stop app worker   # avoid port conflicts

cd ../../app && npm run dev       # http://localhost:3000
cd ../worker && npm run dev       # http://localhost:8000/health/ready
```

- Verify connections: `curl localhost:3000/api/health` (database/redis/s3 must be `ok`) and `curl localhost:8000/health/ready`.
- Execution still runs as Kubernetes Jobs. On OrbStack (no gVisor RuntimeClass) set `EXECUTION_RUNTIME_CLASS_NAME=none` in `worker/.env`; to run a locally built execution image, also set `EXECUTION_IMAGE_PULL_POLICY=Never` and `WORKER_IMAGE=supercheck-worker:latest`. Inspect runs with `kubectl get jobs,pods -n supercheck-execution`. Rebuild the execution image (`docker compose -f docker-compose-local.yml build worker`) after changing execution runtime code.
- Restore the containerized stack: stop the dev servers, then `docker compose -f docker-compose-local.yml up -d app worker`.
- Run `npm run db:migrate` in `app/` after pulling schema changes.
- Stop dev servers you started by PID; do not kill processes you did not start.

Full contributor walkthrough: CONTRIBUTING.md, "Run the app and worker from source against Compose infrastructure".

## Code style

- **App**: strict TypeScript, path aliases `@/*` and `~/*`. **Worker**: CommonJS, decorators enabled. No `any` unless unavoidable.
- Files: kebab-case for components (`data-table.tsx`). Variables camelCase, types PascalCase, constants UPPER_SNAKE_CASE, tables snake_case.
- Imports: external libraries, then internal (`@/...`), then local modules.
- Match the surrounding code's comment density, naming, and idioms.

## Data and tenancy

- Drizzle ORM for queries; schemas in `app/src/db/schema/`. The worker keeps its own subset in `worker/src/db/schema/`: keep it compatible for every table and column the worker reads. Create Zod schemas alongside tables. Primary keys use UUID v7.
- Multi-tenant: scope every query by the owning `organizationId`/`projectId`; client-supplied ids are selectors, not proof of ownership.
- Reject malformed UUID route params before database access (`app/src/lib/uuid.ts`).

## Authentication and authorization

- Import the `Role` type from `app/src/lib/rbac/permissions-client.ts` (never `permissions.ts`).
- Six roles: super_admin, org_owner, org_admin, project_admin, project_editor, project_viewer.
- Better Auth is server-only; never import it in client components.
- Routes callable by CLI/API keys use `requireAuthContext()` and `hasPermissionForUser()`; `hasPermission()` reads the cookie session and breaks bearer callers.
- Return 401 for missing/invalid identity and 403 for insufficient permission. Check permissions before any data operation.

## API routes and server actions

- Validate input with Zod at the boundary, then authorize, then run business logic.
- Return stable, safe error messages and correct status codes; keep internal detail in logs.
- Server actions start with `"use server"`, validate with the shared schema, and return `{ success: true, <domain key> }` or `{ success: false, error }`; follow the neighboring action's key names.

## UI

- Client components start with `"use client"`; prefer Server Components otherwise.
- Read data through the React Query hooks in `app/src/hooks/`; render cached data directly and invalidate the affected query keys after mutations.
- Use the primitives in `app/src/components/ui/` and the oklch tokens in `globals.css` (never `hsl(var(--token))`). See `.agents/skills/ui/SKILL.md`.

## Testing

- Unit tests are colocated `*.spec.ts(x)` (Jest, React Testing Library). DB-backed tests are `*.db.spec.ts` and run only via `npm run test:db`.
- E2E (Playwright, `app/e2e/`): authentication runs once in `tests/auth.setup.ts`; reuse its storage state. Create the records a test needs in `beforeAll` (via `e2e/utils/test-data.ts`) and remove them in `afterAll`. Before interacting after navigation, call `waitForHydration(page)` (`e2e/utils/hydration.ts`) instead of fixed sleeps. Click text columns in table rows, not the first column (it may hold action buttons). Rules: `app/e2e/COVERAGE.md`.

## Test coverage for new and changed behavior

Whenever you add or change functionality, check its test coverage before declaring the work done:

1. Run the affected package's Jest suite with coverage (`npm run test:cov` in `app/`, `worker/` or `cli/`), narrowed to the files you touched, for example `npm run test:cov -- --coverageThreshold='{}' --collectCoverageFrom='<path>' <spec>`. The `--coverageThreshold='{}'` override is required because the global thresholds in `jest.config.js` always fail a run narrowed to a few files; rule 2 is the check that counts.
2. Read the per-file line and branch figures for every file you added or changed. Each new branch (success, failure, boundary and permission-denied paths) needs an assertion.
3. If coverage of the new or changed code is missing, add the tests in the same change. Do not defer them to a follow-up, and never lower a threshold in `jest.config.js` to make a run pass.
4. Start a bug fix with a test that fails on the old behavior and passes on the fix.
5. Put the exact command and the resulting coverage of the touched files in the PR description.

## Environment

- `process.env.SELF_HOSTED === "true"` gates self-hosted behavior; test both modes when behavior differs.
- `AI_PROVIDER` selects the AI provider (OpenAI, Azure OpenAI, Anthropic, Google Gemini, Google Vertex AI, AWS Bedrock, OpenRouter, DeepSeek); see `app/src/lib/ai/`.
- `DATABASE_URL` and `REDIS_URL` configure Postgres and Redis.

## Critical gotchas

1. **Better Auth is ESM-only**: use dynamic imports in CommonJS contexts.
2. **Worker scaling**: `MAX_CONCURRENT_EXECUTIONS=1` is fixed in `worker/src/common/constants/memory.constants.ts`; scale with `WORKER_REPLICAS`.
3. **S3/RustFS**: S3 clients hardcode path-style addressing (`forcePathStyle: true`); keep it when adding a client.
4. **Client vs server**: never import server-only modules into client components.
5. **BullMQ QueueEvents**: each `QueueEvents` needs a dedicated blocking connection (XREAD). In the app, pass Redis options (`connection: buildRedisOptions(...)` in `app/src/lib/queue.ts`) so BullMQ owns that connection; do not pass a `connection.duplicate()`, which BullMQ duplicates again and leaks. BullMQ Workers may share connections, since BullMQ duplicates internally.
6. **App and worker deploy independently**: queue payloads, statuses, and schemas must tolerate version skew.

## Releases (human-only)

- Never create, move, or delete git tags or GitHub releases, and never dispatch the publish workflows.
- Full policy and the tag-signing procedure: `docs/releasing.md`. If a task seems to need a release, stop and ask the maintainer.

## Before making changes

1. Read the matching skill in `.agents/skills/` and existing code in similar files.
2. Ensure tests exist for new behavior, including denied and cross-tenant paths.
3. Run the quality gate above before committing.
4. Update docs (`docs/content/docs/`) and affected skills in the same change.

## Pull request references

Never include a public Supercheck PR link in an ops PR or an ops PR link in a public Supercheck PR. This applies to titles, descriptions, comments, and review replies. Keep related PR descriptions self-contained.

## PR review completion

After creating or updating a PR, wait for all configured AI reviews and required CI to finish on the exact latest PR head. Inspect top-level summaries, submitted reviews (including folded nits), and every inline thread, including outdated or unresolved threads. Verify each finding against current source; fix valid findings with a minimal change and appropriate tests, and explain findings that are declined or stale. After every push, repeat the wait and full review audit until no valid findings remain and final CI passes. If a review is skipped, unconfigured, or unavailable, report that explicitly and never describe it as complete; identify it as a remaining gate when required by the repository or task. Report the exact head and any remaining gates. Never merge or deploy without authorization.

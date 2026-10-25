---
description: Run the Supercheck quality gate for changed packages and fix failures
---

Run the quality gate (AGENTS.md "Quality Gate", mirrors `.github/workflows/pr-validation.yml`) for the packages touched by the current changes and fix every failure it reports.

- App (from `app/`): `npx next typegen && npx tsc --noEmit`, `npm run lint`, `npm run test`
- Worker (from `worker/`): `npx tsc --noEmit`, `npm run lint:check`, `npm test`
- CLI (from `cli/`): `npm run typecheck`, `npm run lint`, `npm test`
- E2E suite (from `app/e2e/`): `npx tsc --noEmit -p tsconfig.json`

Use `git status` / `git diff` against the merge base to decide which packages changed, and skip packages with no changes. Fix the root cause; never silence a failure with `eslint-disable`, `@ts-ignore`, `any`, or skipped tests. Report the exact commands you ran and their results. Do not finish while a relevant check fails.

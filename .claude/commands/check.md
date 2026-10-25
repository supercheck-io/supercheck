---
description: Run the Supercheck quality gate for changed packages and fix failures
---

Run the fast local checks (a subset of CONTRIBUTING.md "Checks" and `.github/workflows/pr-validation.yml`) for the packages touched by the current changes and fix every failure they report.

- App (from `app/`): `npx tsc --noEmit`, `npm run lint`, `npm test`
- Worker (from `worker/`): `npx tsc --noEmit`, `npm run lint:check`, `npm test`
- CLI (from `cli/`): `npm run typecheck`, `npm run lint`, `npm test`
- E2E suite (from `app/e2e/`): `npx tsc --noEmit -p tsconfig.json`
- Docs, deploy, recorder: run the matching section of CONTRIBUTING.md "Checks".

Use `git status` / `git diff` against the merge base to decide which packages changed, and skip packages with no changes. Fix the root cause; never silence a failure with `eslint-disable`, `@ts-ignore`, `any`, or skipped tests. Report the exact commands you ran and their results, and name the CI-only jobs (builds, DB tests) you did not run. Do not finish while a relevant check fails.

# Agent instructions

## Temporary files

- Never create or keep temporary files in either the `supercheck` or `supercheck-ops` repository, even if ignored by Git. Use the operating system temporary directory (for example, `mktemp -d`) for scratch notes, ad hoc reports, logs, patches, downloads, and command output.
- Keep reusable plans and handoffs in Tally scratchpads. Only add documentation intended to be maintained as part of the project.
- Before committing or opening a PR, inspect `git status` and the staged diff; never include temporary artifacts. Remove only temporary files created by the current task, and preserve other people's work.

## Test coverage for new and changed behavior

Whenever you add or change functionality, check its test coverage before declaring the work done:

1. Run the affected package's Jest suite with coverage (`npm run test:cov` in `app/`, `worker/` or `cli/`), narrowed to the files you touched, for example `npm run test:cov -- --coverageThreshold='{}' --collectCoverageFrom='<path>' <spec>`. The `--coverageThreshold='{}'` override is required because the global thresholds in `jest.config.js` always fail a run narrowed to a few files; rule 2 is the check that counts.
2. Read the per-file line and branch figures for every file you added or changed. Each new branch (success, failure, boundary and permission-denied paths) needs an assertion.
3. If coverage of the new or changed code is missing, add the tests in the same change. Do not defer them to a follow-up, and never lower a threshold in `jest.config.js` to make a run pass.
4. Start a bug fix with a test that fails on the old behavior and passes on the fix.
5. Put the exact command and the resulting coverage of the touched files in the PR description.

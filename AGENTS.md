# Agent instructions

## Temporary files

- Never create or keep temporary files in either the `supercheck` or `supercheck-ops` repository, even if ignored by Git. Use the operating system temporary directory (for example, `mktemp -d`) for scratch notes, ad hoc reports, logs, patches, downloads, and command output.
- Keep reusable plans and handoffs in Tally scratchpads. Only add documentation intended to be maintained as part of the project.
- Before committing or opening a PR, inspect `git status` and the staged diff; never include temporary artifacts. Remove only temporary files created by the current task, and preserve other people's work.

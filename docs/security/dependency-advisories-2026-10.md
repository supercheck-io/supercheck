# Dependency advisories — October 2026 triage

Scope: the `braces` and `sprintf-js` denial-of-service advisories that
`npm audit` and Dependabot raised in September–October 2026, and the tooling
reduction made in response.

Last verified: 2026-10-24. Review again on 2027-04-20, or sooner if either
package is flagged again.

## Status

Both advisories were **withdrawn by GitHub** after this triage began. They are
kept here so the history of the decision is traceable.

| Advisory | Package | Severity when published | Withdrawn |
|---|---|---|---|
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `sprintf-js` | medium | 2026-10-22 |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | high | 2026-10-23 |

No upstream patched release of either package was ever published (`braces@3.0.3`
and `sprintf-js@1.1.3` remain the newest), so no fix, downgrade, override or
audit suppression was applied. Nothing needs to change in the dependency tree
because of these two advisories.

Dependabot alerts #685 and #686 (`braces`, vendored Playwright bundle lockfiles
under `recorder/playwright/packages/playwright/bundles/`) were still open at the
time of writing. They point at the withdrawn advisory and should close or be
dismissed as withdrawn; do not treat them as live exposure.

## Where the packages are present

Verified with `npm ls braces sprintf-js` on 2026-10-24:

| Package | `braces` | `sprintf-js` | Path (all dev or build tooling) |
|---|---|---|---|
| `app` | `3.0.3` | `1.1.3`, `1.0.3` | `braces`: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`; Jest → `micromatch`. `sprintf-js`: `@types/mssql` → `tedious` (`1.1.3`); `mammoth` and Jest → `argparse` (`1.0.3`) |
| `worker` | not present | not present | none |
| `cli` | not present | `1.0.3` lockfile entry (Jest → `js-yaml` → `argparse`); `npm ls` reports nothing installed | none |
| `recorder` | `3.0.3` | not checked | vendored Playwright bundle lockfiles (`chokidar`, `jest-message-util`); build and test tooling |

No application, worker or CLI source imports `braces`, `micromatch`,
`fast-glob` or `sprintf-js` directly.

## Tooling reduction (this PR)

The app no longer installs the unused `shadcn` generator. UI component source is
checked in, and no app script or import uses the CLI package. The
`components.json` generator configuration is kept for future component authoring.

This removed the `shadcn` → `ts-morph` dependency chain. It was a safe reduction
of unused dev tooling, not a fix for either advisory. The remaining
`braces`/`micromatch` paths in `app` come from the Next ESLint plugin and Jest.

## Current audit findings are separate

`npm audit` today reports different advisories in the runtime dependency trees,
for example `zod`, `undici`, `body-parser`, `@azure/msal-node`, `multer` and
`fast-uri`. They are unrelated to the two advisories above and are not triaged
in this document. They are tracked in Tally under "Resolve remaining upstream
dev-tool dependency advisories" and must be re-audited against the current
lockfiles before any change is made.

## Revisit criteria

1. Either package is flagged again by a non-withdrawn advisory. Then upgrade it
   (`npm install <pkg>@<fixed>`, plus `overrides` where a transitive parent pins
   it) and re-run the affected package's tests.
2. New application code passes user-controlled input as a glob pattern to
   `micromatch`/`braces` or as a format string to `sprintf-js`.
3. The ESLint, Jest, `mammoth` or `tedious` parents drop the dependency.

## Verification commands

```bash
gh api /advisories/GHSA-vfj7-8cjw-p6xm --jq '{withdrawn_at}'
gh api /advisories/GHSA-hp3w-g68c-fv3c --jq '{withdrawn_at}'
(cd app && npm ls braces sprintf-js)
(cd worker && npm ls braces sprintf-js)
(cd cli && npm ls braces sprintf-js)
(cd recorder && grep -n '"braces"' playwright/packages/playwright/bundles/*/package-lock.json)
```

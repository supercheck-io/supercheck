# Dependency DoS advisories — October 2026 triage

Scope: five advisories surfaced by `npm audit` across `app/`, `worker/`, `cli/`,
and the vendored Playwright bundles in `recorder/`. Both packages behind them
lack an upstream patched release, so this records the evidence and the
accept/guard decision rather than forcing a downgrade.

Triage date: 2026-10-20. Review by: 2027-04-20 (or sooner if either package
publishes a fix).

## Summary

| Advisory | Package | Installed | Fixed in | Decision |
|---|---|---|---|---|
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `sprintf-js` | `1.0.3`, `1.1.3` | none published (`1.1.3` is latest) | Accept — format strings are static literals |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | `3.0.3` | none published (`3.0.3` is latest) | Accept — patterns are build-time or developer-supplied |

`npm audit` offers "fixes" that are downgrades of unrelated parents (for
example `mammoth@0.3.29` and `shadcn@1.0.0`), not patched releases. Applying
them would remove functionality without removing the vulnerable package.

Verified with `npm view braces versions` and `npm view sprintf-js versions` on
2026-10-20: the newest published versions are the installed `3.0.3` and
`1.1.3`.

## sprintf-js — unbounded precision specifier DoS

The advisory affects `sprintf-js <= 1.1.3`. A format string containing an
unbounded precision specifier (for example `%.2147483647f`) makes `sprintf`
allocate and format an enormous string. Exploitation requires control of the
**format string**; values passed as arguments cannot add specifiers.

### Dependency paths

| Package | Version | Path |
|---|---|---|
| app | `1.0.3` | `mammoth@1.11.0` → `argparse@1.0.10` → `sprintf-js` |
| app | `1.1.3` | `@types/mssql` (dev) → `tedious@18.6.1` → `sprintf-js` |
| worker | `1.1.3` | `mssql@11.0.1` → `tedious@18.6.1` → `sprintf-js` |
| cli | `1.0.3` | `@istanbuljs/load-nyc-config` (dev/test) → `argparse` → `sprintf-js` |

### Reachability evidence

- `mammoth` requires `argparse` only for its CLI (`bin/mammoth`). Its library
  code under `lib/` does not import `argparse`, and the app imports the library.
  `argparse` calls `sprintf` with fixed literals
  (`sprintf('ignored explicit argument %r', explicitArg)`), passing the document
  content as an argument, never as the format string.
- `tedious` calls `sprintf` in `lib/login7-payload.js`, `lib/packet.js`,
  `lib/prelogin-payload.js`, `lib/metadata-parser.js`, and
  `lib/value-parser.js`. Every call site passes a string literal as the format;
  packet and column values are arguments.
- No application code calls `sprintf-js` directly (`grep -rn "sprintf" app/src
  worker/src cli/src` returns nothing).

Conclusion: not reachable from attacker-controlled input in any shipped path.
No guard added: the only inputs an attacker controls (docx contents, TDS packet
fields, SQL values) cannot become a format string.

Residual risk: a future dependency upgrade or new direct use of `sprintf-js`
with a user-derived format string would reintroduce the issue. Review this file
when adding such a dependency.

## braces — stack exhaustion from deeply nested patterns

The advisory affects `braces <= 3.0.3`. Expanding a pattern with deeply nested
brace groups (for example thousands of nested `{}`) exhausts the stack.
Exploitation requires control of the **pattern** passed to `braces` /
`micromatch`.

### Dependency paths

| Package | Version | Path |
|---|---|---|
| app | `3.0.3` | `micromatch@4.0.8` → `braces` (`@jest/*`, `fast-glob` via `shadcn`/`ts-morph` — all devDependencies) |
| worker | `3.0.3` | `micromatch@4.0.8` → `braces` (`@jest/*`, `ts-loader` — all devDependencies) |
| cli | `3.0.3` | `micromatch@4.0.8` → `braces` (`@jest/*` — devDependencies) |
| recorder | `3.0.3` | vendored Playwright bundle locks: `playwright/packages/playwright/bundles/utils` (`chokidar` → `braces`) and `.../bundles/expect` (`jest-message-util` → `micromatch` → `braces`) |

### Reachability evidence

- `npm ls braces` in `app/`, `worker/`, and `cli/` resolves only into Jest,
  ESLint/`fast-glob`, and `ts-loader` build tooling. No app, worker, or CLI
  source file imports `braces`, `micromatch`, or `fast-glob`
  (`grep -rn "micromatch\|from 'braces'" {app,worker,cli}/src` returns nothing).
  Patterns come from developer-authored configuration, not from requests.
- The recorder bundle locks are consumed by `npm run ci:pw:*` while building the
  vendored Playwright bundles (`chokidar` watches files, `expect`'s
  `jest-message-util` matches test-name patterns). They are build-time only; the
  extension bundle built by `vite build` does not import them, and recorder
  source has no `micromatch`/`braces` usage.
- These lockfiles are vendored inside the Playwright fork. Hand-editing them is
  out of policy; the correct fix is to bump the vendored Playwright revision
  when upstream Playwright updates its bundle locks.

Conclusion: not reachable from attacker-controlled input in any shipped path.
No guard added.

Residual risk: a future feature that passes user-supplied glob patterns to
`micromatch`/`braces` (for example path filters) would make this reachable.
Such a change should bound pattern length and nesting before matching, or wait
for a patched `braces`.

## What would change this decision

### 2026-10-23 app tooling reduction

The app no longer installs the unused `shadcn` generator. UI component source is
checked in, and no app script or source import uses the CLI package. The
`components.json` generator configuration remains available for future component
authoring.

The app lockfile audit drops from eight high findings to five after removing that
dependency and its `ts-morph` chain. The remaining findings are the Next ESLint
plugin's `fast-glob` / `micromatch` / `braces` chain. Registry checks still report
`braces@3.0.3` as the latest release; upgrading its parent packages does not remove
that dependency. The CLI lockfile audit is now clean. These results do not resolve
the remaining docs or recorder tooling findings, and no major downgrade or audit
suppression was applied.

### Revisit criteria

1. `braces` or `sprintf-js` publishes a version above the vulnerable range.
   Upgrade with the package manager (`npm install <pkg>@<fixed>` plus
   `overrides` where the transitive parent pins it) and re-run the affected
   package tests.
2. New application code calls either package with a user-controlled format
   string or glob pattern.
3. `mammoth`/`tedious`/jest drop the affected dependency.

## Verification commands

```bash
(cd app && npm audit --json | jq '.vulnerabilities["sprintf-js"], .vulnerabilities.braces')
(cd worker && npm ls sprintf-js braces --all)
(cd cli && npm ls sprintf-js braces --all)
(cd recorder && grep -n '"braces"' playwright/packages/playwright/bundles/*/package-lock.json)
npm view braces version && npm view sprintf-js version
```

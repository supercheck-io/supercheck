# Screenshot capture

Recaptures every product screenshot used by the docs and the landing page in one format.

```
BASE_URL=https://demo.supercheck.dev SC_EMAIL=... SC_PASSWORD=... \
  node docs/scripts/screenshots/capture.mjs
```

| Env | Meaning |
|---|---|
| `BASE_URL`, `SC_EMAIL`, `SC_PASSWORD` | target app and the account to sign in with (never logged) |
| `ONLY` | comma list of names, e.g. `ONLY=dashboard,monitors-list.png` |
| `OUT_DIR` | default `docs/public/screenshots`; site WebPs go to `<OUT_DIR>/site/` |

Uses the `playwright` installed under `app/` (run `npm ci` there once) and `sharp` from docs or app, falling back to the `magick` CLI.

## Format rule

- Dark theme everywhere (`localStorage.theme = "dark"`, `colorScheme: dark`).
- One size: viewport 1440x900 at 2x, PNG 2880x1800. Never full page.
- `site: true` entries also write `site/<name>.webp`, the same capture resized to 1600x1000 (the landing `Screenshot` component).
- `viewport: "mobile"` (390x844 at 3x) exists for app shots on a phone. No entry uses it today.
- The dev indicator, support chat bubble and toasts are hidden.

## Output

A table of `captured`, `skipped` (external app or manual), `skipped(needs)` (a step failed and the entry lists the data or permission it needs on the target) and `failed`. Exit code is non-zero only on unexpected errors (sign-in, browser crash).

## Adding or fixing a shot

Add an entry to `manifest.mjs` (field reference at the top of that file): `path`, optional `open` for pages with ids, `actions` for clicks/fills/waits. Test with `ONLY=<name> OUT_DIR=<scratch dir>` and look at the result before pointing it at the repo.

Not automatable: shots of Gmail, Discord, Slack and Teams (`alert-*.png`, `org-admin-member-email-invitation.png`), invitation pages that need a live token, and the impersonation banner. Recapture these by hand at 1440x900 or phone size, dark theme.

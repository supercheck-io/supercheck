# Email templates

All transactional emails are React Email components in this folder. Every template
renders inside `BaseLayout` (Supercheck wordmark, header, `EmailButton`, `DetailsTable`,
footer, preheader), so changes to the look happen in one place.

House style (the `email-verification` email is the reference): one neutral header (`PALETTE.neutral`, white
text) for every email, never a per-type colour. Severity shows only in the body: a small `StatusBadge` (tones in
`palette.ts`) or a tinted `Callout`. Body text is left-aligned 15px `#4b5563`, buttons are `EmailButton`
(`#111827`), details go in `DetailsTable`. Status-page subscriber emails pass `showBrand={false}`; they carry the
customer's page name and a "Powered by" footer.

```
app (Next.js)                         worker (NestJS)
  src/emails/*.tsx  --sync script-->    src/emails/{base-layout,monitor-alert,palette}
  src/lib/email-renderer.ts             src/email-template/email-template.service.ts
    render() -> {subject,html,text}       render() locally, basic-HTML fallback on error
    used by auth, billing, status           used by notification.service.ts for
    pages, incident notifier                monitor / job alert emails
```

The worker renders its alert emails itself: no queue, no Redis round trip, no
dependency on the app being up.

## Templates

| Template | Audience | Rendered by |
|---|---|---|
| `password-reset`, `email-verification`, `organization-invitation`, `test-email` | user | app |
| `usage-notification`, `trial-notification` | org owners | app |
| `status-page-verification`, `status-page-welcome`, `incident-notification` | public status-page subscribers | app |
| `incident-update` | team (incident created/assigned/acknowledged/AI finding/resolved/recovered/reopened) | app (`renderIncidentUpdateEmail`) |
| `monitor-alert` (also used for job failure/success/timeout) | alert recipients | worker |

Alert subjects are `[Supercheck] <Event>: <name>` (`alertEmailSubject`); status-page emails keep `[STATUS] ...`. Job and monitor alerts share one field builder in the worker (`buildEmailFields`).

`monitor-alert` takes an optional `incidentsUrl`; failure/warning emails then show a
"View incidents" button; every alert shows a status badge (recovery: "Resolved").

## Changing a worker-rendered template

1. Edit the file in `app/src/emails/`.
2. Run `node app/scripts/sync-email-templates.mjs` (copies byte for byte to `worker/src/emails/`).
3. `app/src/emails/worker-copy.spec.ts` fails if the copies differ.

To make another template worker-rendered, add it to `FILES` in the sync script and
the drift spec. Templates must not import from `app/src/lib`.

## Adding a template

1. Create `my-template.tsx` using `BaseLayout` and `EmailButton`; give every prop a default so it previews.
2. Export it from `index.ts` and add a `renderMyTemplateEmail` to `lib/email-renderer.ts` returning `{ subject, html, text }`.
3. Add a case to `templates.spec.tsx`.

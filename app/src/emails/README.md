# Email templates

All transactional emails are React Email components in this folder. Every template
renders inside `BaseLayout` (Supercheck wordmark, header, `EmailButton`, `DetailsTable`,
footer, preheader), so changes to the look happen in one place.

House style: dark header colours with white text (red `#b91c1c` problem, amber
`#b45309` warning, blue `#1d4ed8` info, green `#15803d` resolved, gray `#1f2937`
neutral) and `#111827` primary buttons. Status-page subscriber emails pass
`showBrand={false}`; they carry the customer's page name and a "Powered by" footer.

```
app (Next.js)                         worker (NestJS)
  src/emails/*.tsx  --sync script-->    src/emails/{base-layout,monitor-alert}.tsx
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
| `monitor-alert` (also used for job failure/success/timeout) | alert recipients | worker (and app) |

`monitor-alert` takes an optional `incidentsUrl`; failure/warning emails then show a
"View incidents" button, recovery emails show a "Resolved" chip.

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

## Deprecated

The `email-template` BullMQ queue and `lib/processors/email-template-processor.ts` are
kept only so workers from earlier releases keep getting rendered emails during a
rolling deploy. Delete both next release.

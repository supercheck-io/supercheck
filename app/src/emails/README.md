# Email templates

All transactional emails are React Email components in this folder. Every template
renders inside `BaseLayout` (Supercheck wordmark, header, `EmailButton`, `DetailsTable`,
footer, preheader), so changes to the look happen in one place.

House style (the `incident-update` email is the reference): one neutral header (`PALETTE.neutral`, white
text) for every email, never a per-type colour. Severity shows only in the body: a small `StatusBadge` (tones in
`palette.ts`) or a tinted `Callout`. Body text is left-aligned 15px `#4b5563`, buttons are `EmailButton`
(`#111827`), details go in `DetailsTable`. Every email starts with the same header: the Supercheck
lockup (logo tile beside the wordmark, as on the landing page), then the title. Status-page subscriber emails use
the customer's page name as the title and keep the "Powered by" footer.

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
| `status-page-verification`, `status-page-welcome` (sent once a subscriber verifies), `incident-notification` | public status-page subscribers | app |
| `incident-update` | team (incident created/assigned/acknowledged/AI finding/resolved/recovered/reopened) | app (`renderIncidentUpdateEmail`) |
| `monitor-alert` (also used for job failure/success/timeout) | alert recipients | worker |

Subjects: account and alert emails are `[Supercheck] <What happened>: <name>` in sentence case
(`alertEmailSubject` keeps acronyms such as SSL); team incident emails are `[SEV2] #15 <title>: <event>`, cut to
about 70 characters (`incidentUpdateSubject`); status-page emails use the page's language and `[STATUS] ...`.
Job and monitor alerts share one field builder in the worker (`buildEmailFields`).

Every email follows the same rules (`transactional-checklist.spec.tsx` checks them):

- a specific preheader, `lang` set, and a plain-text part (`PLAIN_TEXT_RENDER_OPTIONS`);
- one primary `EmailButton` that opens the resource (incident, monitor, run, invitation...), other links as text;
- absolute links built from `emailAppUrl()` (never a relative or `undefined/...` link);
- timestamps with an explicit zone (`formatEmailTime`, or the status page's own zone);
- a `reason` line saying why it was sent, and a manage link where one exists;
- sentence case, no emoji, no exclamation marks, no internal ids;
- on self-hosted installs (`SELF_HOSTED`) the footer has no supercheck.io legal links;
- subscriber emails are never sent without a signed unsubscribe link and `List-Unsubscribe` header.

`monitor-alert` takes `resourceUrl`/`resourceLabel` (the monitor or run, the main button) and an optional
`incidentsUrl` (failure and warning emails link "View incidents" as text); every alert shows a status badge
(recovery: "Resolved").

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

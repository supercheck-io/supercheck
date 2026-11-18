# Docs standard

Rules for `docs/content/docs/` (Fumadocs). Read before writing or editing a page. `DESIGN.md` covers the theme; `README.md` covers build checks.

## Concise means

- Remove redundancy, restated intros, obvious statements and repeated warnings. Say each fact once and link to it elsewhere.
- Never remove a fact, limit, default, permission, data or security warning, or a diagram. If a fact exists nowhere else, it stays.
- Verify every UI label, default and limit you touch against `app/src` (or `cli/`, `worker/`). Fix the docs when the code differs.
- Concept pages are short. Reference pages may be long but must scan: headings, tables, no walls of text.

## Page template

```mdx
---
title: Heartbeat monitors
description: One sentence for search and cards. Say what the page helps you do.
icon: HeartPulse
---

One or two sentences: what it is and when to use it.

## Set up a heartbeat monitor

<Steps>
<Step>
### Do the first thing
Text.
</Step>
</Steps>

## Reference
Tables, `TypeTable` for options, fields and env vars.

## Troubleshooting
<Accordions>
<Accordion title="Symptom" id="symptom">Fix.</Accordion>
</Accordions>

## Related
<Cards>
<Card title="Page" href="/docs/..." description="Why you would go there" />
</Cards>
```

Sections are optional. Keep the order: intro, task, reference, troubleshooting, related. Hub pages (`index.mdx`) use `<Cards>` for navigation.

## One element per purpose

| Purpose | Element |
|---|---|
| Ordered procedure | `<Steps>` with `### ` step titles. Never a hand-numbered list |
| True alternatives | `<Tabs>`. Labels **Dashboard**, **CLI**, **API**, **MCP** in that order; **Docker**, **Kubernetes** for deployment |
| Tip or note | `<Callout>` (info) |
| Data loss, breaking change, security | `<Callout type="warn">` |
| FAQ and troubleshooting | `<Accordions>` |
| Related links, navigation hubs | `<Cards>` with `title`, `href`, `description` |
| Reference data | Markdown tables. `TypeTable` for options, fields and env vars where it fits |
| Code and files | Fenced block with a language. Add `title="path/to/file"` when it is a file |
| Diagrams | Mermaid, ASCII or `<DiagramEmbed>`. Keep every existing diagram |

- Never use `type="error"`. At most 2 callouts per page, never adjacent.
- Do not use Tabs for sequential steps, to hide content, or for a status-like list. A table does that.
- No emojis. No raw HTML. No hand-written numbering in headings.
- Screenshots: `![Alt text](/screenshots/name.png)` with descriptive alt text; put them after the sentence they illustrate.
- Internal links are absolute: `/docs/app/monitor#maintenance-windows`.

## Style

- Headings in sentence case. Frontmatter `title` also sentence case, except product names.
- UI labels in **bold**, exactly as the UI shows them. Navigation as **Monitor → Create**.
- Second person, present tense, active voice. Short sentences, one idea each.
- Code, paths, flags, env vars and values in `code`.
- Cut filler: "in order to", "note that", "simply", "easily", "just", "please", and marketing adjectives.
- Describe, do not sell. State limits and defaults as numbers.

## Glossary

Use these names. Do not mix in synonyms.

| Term | Meaning | Avoid |
|---|---|---|
| organization | Top-level account; owns billing and members | workspace, account, team |
| project | Container for tests, jobs, monitors inside an organization | workspace |
| monitor | A scheduled availability check (HTTP, ping, port, website, synthetic, heartbeat) | check (except "check" for one execution) |
| test | A Playwright, k6 or API script | script, spec |
| job | A scheduled or triggered group of tests | pipeline, cron |
| run | One execution of a test or job | execution |
| incident | An outage record, internal or on a status page | issue, ticket |
| connector | An integration the AI SRE reads from | integration, plugin |
| notification channel | Where alerts go (email, Slack, webhook...) | alert channel, provider |
| status page | A public page of component status and updates | |

## Checks

From `docs/` with Node 24: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:rendered-api`. Model pages: `app/heartbeat.mdx`, `app/communicate/status-pages.mdx`.

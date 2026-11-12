# DESIGN.md: how Supercheck looks

The visual rules for the app (`app/`), the marketing site and the docs (`docs/`). Read this before changing any UI. The tokens it names live in `app/src/app/globals.css` (app) and `docs/src/app/global.css` (site and docs).

## 1. Theme and atmosphere

A calm tool for people fixing production. The surfaces stay neutral (white and zinc, or near-black in dark mode), and colour carries meaning. The base is shadcn/ui ("new-york", zinc, lucide icons). We follow Vercel for restraint on marketing and pricing pages and Linear for density in tables and lists. The brand is ours: the green check logo, and the colour roles below.

## 2. Colour roles

Every colour has one job. New code uses the token, never a raw palette class or hex value, except inside one of the central maps listed under Components. Older screens still have raw classes; when you touch one, move it to a token.

| Role | Token / class | Where it may appear |
|---|---|---|
| Main action | `bg-primary` (black; white in dark mode) | Primary buttons. Never give a primary button another colour. |
| Secondary action | `variant="outline"` / `variant="ghost"` | Everything else that is clickable |
| Link, focus | blue (`--color-fd-primary` on the site, the `ring` token in the app) | Text links, focus rings |
| Area: Respond (dashboard, incidents, services) | `respond` (orange) | Same |
| Area: Automate (tests, jobs, runs, requirements, variables) | `automate` (sky) | Icon chips, eyebrows, area labels |
| Area: Monitor (monitors) | `monitor` (teal) | Same |
| Area: Communicate (notifications, delivery history) | `communicate` (indigo) | Same |
| AI (Copilot, investigations, AI create, fix and analyze) | `ai` (violet) | Same. Violet means AI and nothing else. |
| Status pages | `statuspage` (the `success` green) | Same. A deliberate exception to "area colours never look like status colours": status pages are about service health and match the green icon on the status page cards. Nothing else uses this tone. |
| Organization (settings, members, projects) | `organization` (bronze) | Page header chip, Quick Create and admin cards, Cmd+K. Not the sidebar. |
| Super Admin | `superadmin` (pink) | Same as Organization |
| Type (test, monitor, job, variable, AI SRE setup, admin setup) | `type-*` palette from `app/src/lib/type-tones.ts` | Icons and icon chips that say what a thing is. Never status, never page chrome. |
| Status | `success`, `warning`, `failure`, plus the `TableBadge` tones | Badges, status dots and charts only, always beside a text label or an icon |

- Area colours mark where you are; status colours say how something is. They never swap jobs. An area colour never shows up on a status badge, and a status colour never decorates a heading.
- Types have their own palette, separate from areas: 14 `--type-*` tokens (oklch, light and dark values). The five original test and monitor colours are Tailwind 600 in light mode and the matching 400 in dark: `sky`, `teal`, `cyan`, `blue`, `purple`; the rest use the same saturation family. Area says where you are, type says what a thing is, so a Browser test icon is `type-sky` even though it lives in the Automate area. Assign a type's tone once in `TYPE_TONE` (`app/src/lib/type-tones.ts`) and read it everywhere (sidebar, Quick Create, Cmd+K, tables, pickers, dialogs) through `typeText()`, `typeTextForce()`, `TYPE_CHIP` or `TYPE_HOVER_BORDER`. Never write a palette class for a type. Type tones are for icons and icon chips (3:1 non-text contrast), not body text.
- Final mapping: tests Browser `sky`, API `teal`, Database `cyan`, Custom `blue`, Performance `purple`; monitors HTTP `teal`, Website `sky`, Ping `cyan`, Port `blue`, Synthetic `purple` (the overlap with tests is intended). A job takes the tone of its engine (Playwright job = Browser, k6 job = Performance). Variables: Variable `stone`, Secret `violet`, File `indigo`. AI SRE setup: Service `cobalt`, Integration `clay`, Private Agent `olive`. Admin setup: Project `slate`, Member `lime`, CLI Token `zinc`. Outside tests and monitors every type has its own tone (`type-tones.spec.ts` enforces it), so adding a type means adding a token.
- Hues used by status (green, amber, red, orange) are not used for types. `violet` (AI) and `indigo` (Communicate) are the only tones that also exist as area colours; they are given to Secret and File, which never sit beside Copilot or Status Pages.
- Brand marks (Playwright, k6, Chrome) keep their brand colours; the type tone tints the chip or text next to them. Notification provider colours (`alerts/data.tsx`) stay a per-feature brand map.
- Incident lifecycle: Triggered `danger`, Acknowledged `warning`, Investigating `info`, Fixing `purple`, Monitoring `cyan`, Resolved `success` (`app/src/lib/sre/incident-status-display.ts`).
- Status badges never use an area colour: `indigo` is reserved for the Communicate area, so Fixing and monitor Maintenance use `purple`.
- Charts use `var(--chart-1)` to `var(--chart-5)`, and raw `var(--success)`, `var(--warning)` and `var(--failure)` for bright fills. Never write `hsl(var(--token))`: the tokens are oklch.
- Contrast: Tailwind classes (`text-success`, `bg-warning/10`, `text-monitor`, ...) resolve to shades that meet WCAG AA (4.5:1) on cards in light mode (`--success-strong`, `--warning-strong`, `--failure-strong`, and the 700-shade area values; 600 for communicate, still above 6:1 on white; Organization and Super Admin are icon colours only). Don't use the raw chart `var()`s for text.

## 3. Typography

- Geist Sans and Geist Mono, from the `geist` package (bundled font files, so builds work offline). Everything goes through `font-sans` and `font-mono`.
- Page title `text-2xl font-semibold`, card title `text-sm font-semibold` or `text-base font-semibold`, body `text-sm`, captions and help text `text-xs text-muted-foreground`.
- Numbers in tables and metrics use `tabular-nums`.
- Sentence case for headings, buttons and labels ("Create monitor", not "Create Monitor").

## 4. Components

| Need | Use | File |
|---|---|---|
| Area colour and icon of a destination | `NAV` in `app/src/lib/nav-areas.ts`: the one place that maps a page to its icon and area tone. The sidebar, command palette (Cmd+K), Quick Create and page headers read it; never pick a tone or icon per page. | `app/src/lib/nav-areas.ts` |
| Page title row | `PageHeader` with `icon` and `tone` from `NAV` | `app/src/components/shared/page-header.tsx` |
| Colour of a type (test, monitor, job, variable, AI SRE setup, admin setup) | `TYPE_TONE` in `app/src/lib/type-tones.ts`; `type-tones.spec.ts` fails if a type surface uses an ad-hoc colour | `app/src/lib/type-tones.ts` |
| Create actions (sidebar Create menus, Cmd+K Create section) | `CREATE_ACTIONS` in `app/src/lib/create-actions.ts`: one icon, title, URL and colour per action, in Quick Create order | `app/src/lib/create-actions.ts` |
| Tinted icon (page, section or event type) | `IconChip` (`size="sm"` for sections, `"md"` for page titles) | `app/src/components/ui/icon-chip.tsx` |
| Section heading inside a card | `SectionTitle` (chip, title, count, hint, action) | `app/src/components/sre/incidents/incident-ui.tsx` |
| Table footer | `DataTablePagination` (label `Total {n} {itemName}`, rows-per-page fitted to the window) | `app/src/components/ui/data-table-pagination.tsx` |
| Status or category badge | `TableBadge` with a tone | `app/src/components/ui/table-badge.tsx` |
| Callout (info, success, warning, error box) | `Alert` with `variant="info" | "success" | "warning" | "error"` (`destructive` for blocking errors) | `app/src/components/ui/alert.tsx` |
| People | `UserCell` and `UserAvatar` | `app/src/components/ui/user-cell.tsx` |
| Buttons | `Button` variants (`default`, `secondary`, `outline`, `ghost`, `link`, `destructive`). Never override a button's colour with a `className`. | `app/src/components/ui/button.tsx` |

List tables that have a View menu (monitors, tests, jobs, requirements) hide the UUID column by default (`id: false` in the initial column visibility), and the column must stay hideable so people can show it again. Tables without a View menu, and admin configuration tables, keep it visible.

The sidebar marks the current page with its active state, and the active icon takes its group's area colour (`components/nav-main.tsx`). The Settings group has none: Organization and Super Admin look like a plain sidebar item and keep their colours in page header chips, Quick Create and Cmd+K.

Rules for chips:
- One chip per page title and at most one per card header. Rows in tables and form fields get no chips.
- A chip is decorative (`aria-hidden`). The text next to it carries the meaning.

## 5. Layout

- App pages: `PageBreadcrumbs`, then one `Card` (`m-4`) holding the feature component. The title row is `PageHeader`, search and filters go on a toolbar row under it, then the content.
- Spacing comes from the 4px scale (`gap-2`, `gap-3`, `p-4`, `p-6`). Card padding is `p-6` on pages and `p-4` inside panels.
- Radius: `rounded-md` for controls and small (`sm`) chips, `rounded-lg` for page (`md`) chips and small panels, `rounded-xl` for cards and screenshots.
- Marketing and pricing: content width `max-w-6xl`, sections separated by `py-24`, left-aligned headings, one idea per section.

## 6. Depth and elevation

Flat by default: borders (`border`) separate surfaces. Use `shadow-sm` on page cards and popovers only. No glows, no gradients behind content, no `backdrop-blur` on content cards. The one exception is a soft shadow under product screenshots on the site.

## 7. Do and don't

| Do | Don't |
|---|---|
| Use tokens (`text-muted-foreground`, `bg-ai/10`, `text-monitor`) | Hard-code hex, `rgb()`, `hsl(...)`, or `text-green-500` for a status |
| Give every page title its area chip | Put chips in table rows or on every card |
| Keep primary actions black | Make a blue, green or gradient primary button |
| Pair every status colour with a word or an icon | Rely on colour alone to say "down" |
| Reuse `PageHeader`, `IconChip`, `DataTablePagination` | Copy a toolbar or pagination component into a feature folder |
| Check light and dark mode, at 390px and 1440px | Ship a screen you have only seen in one theme |

## 8. Responsive behaviour

- Nothing may overflow at 390px. Stat strips wrap, tables scroll inside their card, and long names truncate with a tooltip.
- Page chips stay visible on mobile. Copilot hides its chip below `sm` to give the title room.
- The marketing site stacks feature rows into a single column below `lg`, and pricing cards stack below `md`.

## 9. Raw colour guard

`app/src/lib/design-tokens.spec.ts` counts raw palette classes (`text-green-500`, `bg-amber-100`, ...) in `app/src` and fails if the count rises above its `BASELINE`. Raw neutral greys (`text-gray-500`, `bg-zinc-100`, ...) have their own `NEUTRAL_BASELINE`; use `text-muted-foreground`, `bg-muted`, `border` and `bg-accent` instead. When you remove raw colours, lower the baseline in the same PR. Never raise it. Exempt paths: emails (clients need inline colours), `components/logo/`, the central maps (`table-badge.tsx`, `icon-chip.tsx`, `alert.tsx`; type colours live in `type-tones.ts` as tokens, not palette classes), user-chosen tag colours (`tag-selector.tsx`), and the public status pages (`status-pages/public-*`, customer branding).

Category colours with no token (user roles, file types, notification providers, priority levels) stay in one map per feature. Don't scatter them across components.

## 10. Agent checklist

Before you finish any UI change:
1. Every colour you added is a token or comes from one of the central maps in section 4, and `npx jest src/lib/design-tokens.spec.ts` passes.
2. Primary actions use the default `Button` variant.
3. New pages use `PageHeader` with the right area `icon` and `tone`. New tables use `DataTablePagination`.
4. You checked light and dark mode at 390px and 1440px (the PR Screenshots workflow covers the app tour).
5. If you added a pattern, you documented it here in the same PR.

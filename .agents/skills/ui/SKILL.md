---
name: supercheck-ui
description: Build or change Supercheck web app UI, such as pages, layouts, components, tables, forms, dialogs, charts, sidebar navigation, empty, loading and error states, dark mode, responsive layout, or accessibility, and verify it visually. For the docs site use the docs/ conventions; for data hooks see supercheck-architecture.
---

# Supercheck UI

The app is Next.js 16 + React 19 with Tailwind 4 and shadcn-style components (`app/components.json`: style `new-york`, base color zinc, CSS variables, lucide icons). Reuse what exists before writing new UI.

## Start here

| File | Why |
|---|---|
| `app/src/components/ui/` | Primitives (button, card, dialog, alert-dialog, form, field, table, data-table-*, chart, skeleton, tooltip, sidebar, ...) |
| `app/src/app/globals.css` | Design tokens (oklch CSS variables, `@theme inline` mappings, `.dark` overrides) |
| `app/src/app/(main)/monitors/page.tsx` | Reference page layout |
| `app/src/components/app-sidebar.tsx` | Sidebar navigation entries |
| `app/src/hooks/` | React Query hooks the UI reads from |

## Page structure

- Pages render `<PageBreadcrumbs items={...} />` (`components/page-breadcrumbs.tsx`) followed by a `Card` with `CardContent` holding the feature component. Follow the neighboring page; there is no separate page-header component.
- Keep `page.tsx` a Server Component and put interactive parts in a `"use client"` feature component.
- Route-level loading uses `app/(main)/loading.tsx` (`components/shared/supercheck-loading.tsx`). Tables use `ui/data-table-skeleton.tsx` or `ui/table-skeleton.tsx`; generic placeholders use `ui/skeleton.tsx`.
- Every list or panel needs explicit loading, empty, and error states. Reference empty state: `components/dashboard/dashboard-empty-state.tsx`. App-level errors: `app/error.tsx`, `not-found.tsx`.

## Components and patterns

- Tables: TanStack Table with the `ui/data-table-*` pieces (column header, faceted filter, view options). Reference: `components/monitors/data-table.tsx`.
- List tables fit the window: use `useFitPagination` / `useFitPageSize` and `pageSizeOptions` from `hooks/use-fit-page-size.ts` (rows per page follow the viewport; a manual choice overrides). Pass a fixed size for tables embedded in sheets. Pages that must fill the viewport without scrolling put `data-fit-viewport` on their root (the layout reads it).
- Forms: react-hook-form with `zodResolver` and the shared Zod schemas; use `ui/form.tsx` or `ui/field.tsx` as the neighboring form does.
- Destructive actions confirm with `ui/alert-dialog.tsx` and name the object being deleted.
- Feedback: `toast` from `sonner` (the `<Toaster>` is `ui/sonner.tsx`).
- Long values: `ui/truncated-text-with-tooltip.tsx`; ids: `ui/uuid-field.tsx`; copy: `ui/copy-button.tsx`.
- Icons from `lucide-react` only.

## Tokens, theming, charts

- Colors come from CSS variables in `globals.css`, which are **oklch**. Use Tailwind token classes (`bg-primary`, `text-muted-foreground`, `border`) or `var(--token)`. Never hard-code hex/rgb, and never wrap a token in `hsl(...)`: `hsl(var(--chart-1))` is invalid CSS on oklch values and renders no color.
- Chart colors: `var(--chart-1)` to `var(--chart-5)` (Tailwind `--color-chart-*` is mapped in `@theme inline`). Charts use recharts through `ui/chart.tsx` (`ChartContainer`).
- Dark mode is the `.dark` class from next-themes (`components/theme-provider.tsx`). Check every change in both themes.
- Fonts are system stacks mapped to `--font-sans`/`--font-mono` (no web font downloads).

## Data in components

- Read data through the hooks in `app/src/hooks/`; render cached data directly, do not copy it into state.
- After a mutation, invalidate the affected `*_QUERY_KEY` arrays (scoped as `[...KEY, projectId]`).
- Prefetch and mounted queries sharing a key must use the same normalized fetcher and bind requests to that key's project. Reset project-specific analytics state when the project changes.
- Usage or limit numbers shown in UI must use the same counting as the server; label estimates as estimates.

## Accessibility and responsiveness

- Icon-only buttons need an `aria-label` and usually a `Tooltip`. Keep the visible `focus-visible` rings from `ui/button.tsx`; do not remove outlines.
- Everything must be keyboard reachable; dialogs trap and restore focus (the primitives already do; do not replace them).
- Layouts must not overflow at 390px width: wrap stat strips, let tables scroll inside their card, truncate long names with a tooltip.

## Verify

- Unit: colocated `*.spec.tsx` with React Testing Library for logic-bearing components.
- Visual: run the app and screenshot the changed pages at 390px and 1440px in light and dark (Playwright, for example the `playwright-cli` skill). Check empty, loading, and error states, not only the happy path.
- E2E selectors must survive hydration: interact after `waitForHydration` (`app/e2e/utils/hydration.ts`); `components/hydration-ready.tsx` sets the marker.
- `npm run lint` (max warnings 0) and `npx tsc --noEmit` in `app/`.

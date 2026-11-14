// Client-safe: no node imports, so client components can share the button styles.
// Primary actions are black (white in dark mode); blue is for links and focus only. See DESIGN.md.
export const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md bg-fd-foreground px-4 py-2.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";
export const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md border border-fd-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";
export const textLink =
  "inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";

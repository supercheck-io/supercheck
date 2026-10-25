export const RUNS_VIEWS = ["all", "k6", "playwright"] as const;
export type RunsView = (typeof RUNS_VIEWS)[number];

/** Unknown or missing `?view=` values fall back to the default "all" table. */
export function parseRunsView(value: string | null | undefined): RunsView {
  return (RUNS_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as RunsView)
    : "all";
}

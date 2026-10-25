const TYPE_LABELS: Record<string, string> = {
  api: "API",
  browser: "browser",
  database: "database",
  custom: "custom",
  performance: "performance",
};

/** "1 API · 2 browser" for the Tests KPI caption; empty string when there is nothing to show. */
export function formatTestTypeBreakdown(
  byType: Array<{ type: string; count: number }> | undefined | null
): string {
  if (!byType) return "";
  return byType
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .map((item) => `${item.count} ${TYPE_LABELS[item.type.toLowerCase()] ?? item.type.toLowerCase()}`)
    .join(" · ");
}

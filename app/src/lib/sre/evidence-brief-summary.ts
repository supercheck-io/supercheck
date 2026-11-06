/** One-line timeline text for a generated evidence brief; also used for rows stored without it. */
export function describeEvidenceBrief(data: {
  suspectedFailureDomain?: unknown;
  evidenceCount?: unknown;
  confidenceScore?: unknown;
}): string {
  const parts: string[] = [];
  if (typeof data.evidenceCount === "number") {
    parts.push(`${data.evidenceCount} evidence ${data.evidenceCount === 1 ? "item" : "items"} reviewed`);
  }
  if (typeof data.suspectedFailureDomain === "string" && data.suspectedFailureDomain.trim()) {
    parts.push(`suspected failure domain: ${data.suspectedFailureDomain.trim().replace(/_/g, " ")}`);
  }
  if (typeof data.confidenceScore === "number" && Number.isFinite(data.confidenceScore)) {
    parts.push(`confidence ${Math.round(data.confidenceScore * 100)}%`);
  }
  const text = parts.length ? parts.join("; ") : "Evidence brief generated";
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

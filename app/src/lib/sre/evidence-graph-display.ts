export function formatSreEvidenceGraphTitle(
  value: string | null,
  fallback: string,
  maxLength = 140,
) {
  const firstContentLine = value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstContentLine) {
    return fallback;
  }

  const plainTitle = firstContentLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainTitle || /^incident investigation report\b/i.test(plainTitle)) {
    return fallback;
  }

  return plainTitle.length > maxLength
    ? `${plainTitle.slice(0, maxLength - 3)}...`
    : plainTitle;
}

export function formatSreInvestigationTypeLabel(agentType: string) {
  const labels: Record<string, string> = {
    investigation: "AI investigation",
    sre_ai: "Evidence brief",
    triage: "AI triage",
    background: "Background analysis",
  };

  return labels[agentType] ?? agentType.replace(/_/g, " ");
}

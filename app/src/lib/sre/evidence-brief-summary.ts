import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

const HEADING = /^\s*#{1,6}\s/;
const SUMMARY_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:executive summary|summary|conclusion)(?:\*\*)?:?\s*$/i;
// "**Summary:** text" on one line.
const INLINE_SUMMARY = /^\s*\*\*(?:executive summary|summary|conclusion):?\*\*:?\s*(\S.*)$/i;
// Header fields that repeat the page ("- **Severity**: sev2", "Incident ID: …", "Stored Evidence: 7 items"), a bold-only title line, or a horizontal rule.
// Other "**Label:** text" lines carry findings and are kept.
const META_LINE =
  /^\s*(?:[-*]\s+)?\*\*(?:incident(?: title)?|title|severity|status|(?:primary )?service|evidence source|evidence items|primary signal)(?:\*\*\s*:|:\*\*)|^\s*\*\*[^*\n]*\b(?:report|overview|classification|details|analysis|hypotheses)\b[^*\n]*\*\*:?\s*$|^\s*(?:[-*]\s+)?(?:\*\*)?incident id(?:\*\*)?\s*:|^\s*(?:[-*]\s+)?(?:\*\*)?(?:stored|connector) evidence:?(?:\*\*)?:?\s*\d+\s+items?\b(?:\s*\([^)\n]*\))?\s*$|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/i;
// Only the old evidence-brief report format, which always had this title or a Report Details section.
// Any other heading (Executive Summary included) can be an investigation's own structure and is kept whole.
const LEGACY_REPORT = /^\s*#{1,6}\s*(?:incident (?:investigation )?report|report details)\b/im;

function plain(text: string) {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // End on a whole sentence when one ends past the halfway point, so a summary never stops mid-thought.
  // A sentence end is ". ", "? " or "! " before a capital or digit, so "e.g. the" and "etc. and" are not.
  let sentence = -1;
  for (const match of text.matchAll(/[.?!](?= [A-Z0-9])/g)) {
    if (match.index >= max) break;
    sentence = match.index;
  }
  if (sentence > max * 0.5 && !/\b(?:e\.g|i\.e|etc|vs|approx|cf)$/i.test(text.slice(0, sentence))) {
    return text.slice(0, sentence + 1);
  }
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.75 ? space : max)}…`;
}

/**
 * One plain-text paragraph from an AI report: the Summary/Conclusion section when the report has one,
 * otherwise the first prose paragraph after any title and field lines. Evidence-id lists are dropped.
 * Older reports were stored whole where a headline is expected, so readers apply this on read too.
 */
export function reportHeadline(text: string | null | undefined, max = 600): string | null {
  if (!text?.trim()) return null;
  const lines = stripEvidenceIdLists(text).split("\n");
  const inline = lines.map((line) => INLINE_SUMMARY.exec(line)?.[1]).find(Boolean);
  if (inline) return clip(plain(inline), max);
  const summaryAt = lines.findIndex((line) => SUMMARY_HEADING.test(line));
  if (summaryAt >= 0) {
    const section: string[] = [];
    for (const line of lines.slice(summaryAt + 1)) {
      if (HEADING.test(line) || SUMMARY_HEADING.test(line)) break;
      if (!line.trim()) {
        if (section.length) break;
        continue;
      }
      section.push(line);
    }
    const body = plain(section.join("\n"));
    if (body) return clip(body, max);
  }
  const paragraphs = lines.join("\n").split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const prose = paragraph.split("\n").filter((line) => line.trim() && !HEADING.test(line) && !META_LINE.test(line));
    const body = plain(prose.join("\n"));
    if (body) return clip(body, max);
  }
  const fallback = plain(lines.filter((line) => !HEADING.test(line)).join("\n").replace(/\*\*[^*\n]{1,60}\*\*\s*:?/g, ""));
  return fallback ? clip(fallback, max) : null;
}

/** First sentence of the fallback brief written when an incident has no stored evidence yet. */
export const NO_EVIDENCE_HEADLINE = "No stored incident evidence was available for this incident yet.";

/** True for the no-evidence fallback brief or its headline: a prompt to collect evidence, not a root cause. */
export function isNoEvidenceBrief(text: string | null | undefined): boolean {
  return Boolean(reportHeadline(text)?.startsWith(NO_EVIDENCE_HEADLINE));
}

// The notice, its "Generate or link …" follow-up sentence, and a Summary heading right above it.
const NO_EVIDENCE_NOTICE = new RegExp(
  `(?:^[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\*\\*)?summary(?:\\*\\*)?:?[ \\t]*\\n)?${NO_EVIDENCE_HEADLINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[ \\t]+Generate or link[^.\\n]*\\.)?`,
  "gim",
);

/** Removes the no-evidence notice and keeps any other text, for example a resolution note pre-filled from it. */
export function withoutNoEvidenceNotice(text: string | null | undefined): string | null {
  const kept = (text ?? "").replace(/\r\n?/g, "\n").replace(NO_EVIDENCE_NOTICE, "").replace(/\n{3,}/g, "\n\n").trim();
  return kept || null;
}

/** A stored root cause for readers: a whole report (older briefs) becomes its headline; a conclusion stays as is. */
export function storedRootCause(text: string | null | undefined, max = 2000): string | null {
  if (!text?.trim()) return null;
  return LEGACY_REPORT.test(text)
    ? reportHeadline(text, max)
    : stripEvidenceIdLists(text);
}

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

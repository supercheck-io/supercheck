/**
 * Evidence a Copilot reply cites, kept with the reply so its "[1] Loki" footnotes still open after a reload.
 * Built from the reply's own tool results (connector searches, stored evidence); nothing is fetched again.
 */
export type SreChatCitation = {
  id: string;
  sourceType: string;
  title: string;
  summary: string | null;
  sourceUri: string;
  evidenceType: string;
  observedAt: string | null;
  citationQuery: string | null;
  rawContentExcerpt: string | null;
};

export const SRE_CITATIONS_ATTACHMENT = "citations";
const MAX_CITATIONS = 20;

/** Evidence ids as replies write them: live connector results and stored evidence uuids. */
export const CITATION_ID_SOURCE = String.raw`connector_[0-9a-f]{12,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : null;
}

/** Reads one citation from untrusted JSON (tool output or a stored attachment); null when it is not one. */
function toCitation(value: unknown): SreChatCitation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 80);
  const title = text(record.title, 300);
  if (!id || !title || !new RegExp(`^(?:${CITATION_ID_SOURCE})$`, "i").test(id)) return null;
  const observedAt = text(record.observedAt, 40);
  return {
    id,
    sourceType: text(record.sourceType, 40) ?? "other",
    title,
    summary: text(record.summary, 600),
    sourceUri: text(record.sourceUri, 1000) ?? "",
    evidenceType: text(record.evidenceType, 40) ?? "evidence",
    observedAt: observedAt && !Number.isNaN(Date.parse(observedAt)) ? observedAt : null,
    citationQuery: text(record.citationQuery, 500),
    rawContentExcerpt: text(record.rawContentExcerpt, 1000),
  };
}

/** Evidence items in a message's tool outputs (AI SDK `output` or assistant-ui `result`) that the text cites. */
export function extractCitations(parts: unknown, replyText: string): SreChatCitation[] {
  if (!Array.isArray(parts)) return [];
  const cited = replyText.toLowerCase();
  const found = new Map<string, SreChatCitation>();
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    const output = (record.output ?? record.result) as Record<string, unknown> | undefined;
    const evidence = output && typeof output === "object" ? output.evidence : null;
    if (!Array.isArray(evidence)) continue;
    for (const item of evidence) {
      const citation = toCitation(item);
      if (citation && !found.has(citation.id) && cited.includes(citation.id.toLowerCase())) {
        found.set(citation.id, citation);
      }
    }
  }
  return [...found.values()].slice(0, MAX_CITATIONS);
}

/** Citations stored in a message's attachments. */
export function citationsFromAttachments(attachments: Record<string, unknown>[] | null | undefined): SreChatCitation[] {
  const stored = attachments?.find((item) => item.type === SRE_CITATIONS_ATTACHMENT)?.items;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((item) => toCitation(item) ?? []).slice(0, MAX_CITATIONS);
}

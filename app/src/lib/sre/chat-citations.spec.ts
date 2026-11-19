import { citationsFromAttachments, extractCitations, SRE_CITATIONS_ATTACHMENT } from "./chat-citations";

const item = {
  id: "connector_0123456789abcdef01234567",
  sourceType: "loki",
  title: "Loki logs",
  summary: "s",
  sourceUri: "https://loki.example.test",
  evidenceType: "log",
  observedAt: "2026-11-19T04:00:00.000Z",
};

describe("chat citations", () => {
  it("keeps only tool evidence the reply cites, from AI SDK and assistant-ui parts", () => {
    const other = { ...item, id: "connector_ffffffffffffffffffffffff" };
    const parts = [
      { type: "text", text: "x" },
      { type: "tool-searchLiveConnectorEvidence", output: { evidence: [item, other] } },
      { type: "tool-call", result: { evidence: [{ ...item, id: "8f1e2a9c-1111-4222-8333-444455556666" }] } },
    ];
    const cited = extractCitations(parts, "see connector_0123456789abcdef01234567 and evidence 8f1e2a9c-1111-4222-8333-444455556666");
    expect(cited.map((entry) => entry.id)).toEqual(["connector_0123456789abcdef01234567", "8f1e2a9c-1111-4222-8333-444455556666"]);
  });

  it("drops malformed stored items and reads the attachment back", () => {
    const stored = [{ type: SRE_CITATIONS_ATTACHMENT, items: [item, { id: "not-an-id", title: "x" }, "junk"] }];
    expect(citationsFromAttachments(stored)).toEqual([expect.objectContaining({ id: item.id, title: "Loki logs" })]);
    expect(citationsFromAttachments(null)).toEqual([]);
  });
});

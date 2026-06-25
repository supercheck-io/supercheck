import { sanitizeConnectorEvidence } from "./output-sanitizer";
import { type ConnectorEvidenceItem } from "./connector-base";

const item: ConnectorEvidenceItem = {
  id: "evidence_1",
  source: "github",
  sourceUri: "https://api.github.com/repos/acme/app?access_token=ghp_abcdefghijklmnopqrstuvwxyz",
  title: "Deploy by alice@example.com",
  summary: "Authorization: Bearer secret-token-123 caused no issue",
  rawContent: "password=hunter2 api_key=super-secret ghp_abcdefghijklmnopqrstuvwxyz",
  evidenceType: "deployment",
  metadata: {
    timestamp: new Date("2026-06-21T10:00:00.000Z"),
    tags: ["deploy"],
  },
  citation: {
    connectorId: "connector_1",
    query: "token=ghp_abcdefghijklmnopqrstuvwxyz",
    resultHash: "hash_1",
  },
};

describe("sanitizeConnectorEvidence", () => {
  it("redacts secrets and PII before returning connector evidence", () => {
    const result = sanitizeConnectorEvidence([item], { maxRows: 10, maxBytes: 10_000, maxSeconds: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Deploy by [REDACTED_EMAIL]");
    expect(result.items[0].summary).toBe("Authorization: Bearer [REDACTED] caused no issue");
    expect(result.items[0].rawContent).not.toContain("hunter2");
    expect(result.items[0].rawContent).not.toContain("ghp_");
    expect(result.resultHash).toHaveLength(64);
  });

  it("enforces row limits", () => {
    const result = sanitizeConnectorEvidence([item, { ...item, id: "evidence_2" }], {
      maxRows: 1,
      maxBytes: 10_000,
      maxSeconds: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

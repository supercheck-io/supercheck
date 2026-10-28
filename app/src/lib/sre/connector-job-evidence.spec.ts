import { normalizePrivateAgentEvidenceSummaries } from "./connector-job-evidence";

describe("normalizePrivateAgentEvidenceSummaries", () => {
  it("returns bounded sanitized Private Agent evidence summaries", () => {
    const result = normalizePrivateAgentEvidenceSummaries({
      evidence: [
        {
          id: "evidence_1",
          sourceUri: "https://prometheus.example/graph?g0.expr=up",
          title: "Prometheus metric: up",
          summary: "Service was down for 2 minutes",
          evidenceType: "metric",
          observedAt: "2026-06-22T10:00:00.000Z",
          resultHash: "a".repeat(64),
        },
      ],
      truncated: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "evidence_1",
      evidenceType: "metric",
      observedAtDate: new Date("2026-06-22T10:00:00.000Z"),
    });
  });

  it("drops malformed summaries and unsupported evidence types", () => {
    const result = normalizePrivateAgentEvidenceSummaries({
      evidence: [
        {
          id: "bad_type",
          sourceUri: "https://example.com",
          title: "Unsupported",
          summary: "Nope",
          evidenceType: "secret_dump",
          observedAt: "2026-06-22T10:00:00.000Z",
          resultHash: "b".repeat(64),
        },
        {
          id: "bad_hash",
          sourceUri: "https://example.com",
          title: "Bad hash",
          summary: "Nope",
          evidenceType: "event",
          observedAt: "2026-06-22T10:00:00.000Z",
          resultHash: "not-a-hash",
        },
      ],
    });

    expect(result).toEqual([]);
  });

  it("redacts secrets in title, summary and sourceUri", () => {
    const [item] = normalizePrivateAgentEvidenceSummaries({
      evidence: [
        {
          id: "e1",
          sourceUri: "https://loki.example/query?token=abc123secret&q=up",
          title: "log password=hunter2",
          summary: "Authorization: Bearer abcdef123456 and password=hunter2",
          evidenceType: "log",
          observedAt: "2026-06-22T10:00:00.000Z",
          resultHash: "a".repeat(64),
        },
      ],
    });
    const out = JSON.stringify(item);
    expect(out).not.toMatch(/hunter2|abcdef123456|abc123secret/);
  });
});

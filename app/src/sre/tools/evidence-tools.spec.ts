/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

import { listStoredSreEvidence } from "./evidence-tools";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: { select: jest.Mock };
};

const scope = {
  organizationId: "018f0000-0000-7000-8000-000000000001",
  projectId: "018f0000-0000-7000-8000-000000000002",
  incidentId: "018f0000-0000-7000-8000-000000000003",
};

describe("SRE evidence tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns bounded redacted stored evidence", async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        id: "evidence-1",
        sourceType: "prometheus",
        sourceUri: "https://prometheus.example?token=secret-value",
        title: "Metric token=secret-value",
        summary: "Authorization: Bearer abc123",
        rawContentExcerpt: "password=supersecret",
        evidenceType: "metric",
        severity: null,
        confidence: "0.8000",
        citationQuery: "up{token=secret-value}",
        citationResultHash: "a".repeat(64),
        observedAt: new Date("2026-06-22T10:00:00.000Z"),
        createdAt: new Date("2026-06-22T10:01:00.000Z"),
      },
    ]);
    const orderBy = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ orderBy }));
    const from = jest.fn(() => ({ where }));
    mockDb.select.mockReturnValue({ from });

    const evidence = await listStoredSreEvidence({ ...scope, sourceMode: "connector", limit: 99 });

    expect(limit).toHaveBeenCalledWith(25);
    expect(evidence[0]).toMatchObject({
      id: "evidence-1",
      sourceType: "prometheus",
      evidenceType: "metric",
      observedAt: "2026-06-22T10:00:00.000Z",
    });
    expect(JSON.stringify(evidence)).not.toContain("secret-value");
    expect(JSON.stringify(evidence)).not.toContain("abc123");
    expect(JSON.stringify(evidence)).not.toContain("supersecret");
  });
});

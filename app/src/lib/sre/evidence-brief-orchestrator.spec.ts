import { PgDialect } from "drizzle-orm/pg-core";
import { collectNativeEvidence } from "./native-evidence-collector";
import { runSreEvidenceBriefGeneration } from "./evidence-brief-orchestrator";

const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockSet = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
const mockValues = jest.fn(() => ({ returning: jest.fn().mockResolvedValue([{ id: "brief-run" }]) }));
jest.mock("@/utils/db", () => ({ db: {
  select: () => ({ from: () => ({ where: (condition: unknown) => {
    mockWhere(condition);
    return { orderBy: () => ({ limit: mockLimit }), limit: mockLimit };
  } }) }),
  insert: () => ({ values: mockValues }),
  transaction: async (callback: (tx: unknown) => unknown) => callback({
    update: () => ({ set: mockSet }),
    insert: () => ({ values: jest.fn().mockResolvedValue(undefined) }),
  }),
} }));
jest.mock("./native-evidence-collector", () => ({ collectNativeEvidence: jest.fn() }));
jest.mock("@/lib/ai/ai-provider", () => ({ getActualModelName: () => "test-model" }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

const observedAt = new Date("2026-09-08T09:00:00Z");
const row = {
  id: "direct-evidence", sourceType: "prometheus", title: "Checkout errors",
  summary: "5 errors", evidenceType: "metric", severity: null, confidence: "0.8",
  sourceUri: "https://metrics.example/graph", rawContentExcerpt: null, observedAt,
};

describe("evidence brief stored evidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(collectNativeEvidence).mockResolvedValue({
      incident: { id: "incident-a", title: "Checkout", severity: "sev2", status: "investigating", primaryServiceId: null, createdAt: observedAt },
      window: { since: new Date("2026-09-08T08:00:00Z"), until: new Date("2026-09-08T09:10:00Z"), source: "incident.createdAt", confidence: 0.5 },
      evidence: [],
    });
  });

  it("includes saved direct connector evidence with tenant, incident, time and row bounds", async () => {
    mockLimit.mockResolvedValue([row, row]);
    const generateBrief = jest.fn().mockResolvedValue({ provider: "fallback", summary: "Brief", modelId: "test-model", confidenceScore: 0.5, suspectedFailureDomain: "Unknown", citedEvidenceIds: [row.id] });
    const result = await runSreEvidenceBriefGeneration({ userId: "user-a", organizationId: "org-a", projectId: "project-a", incidentId: "incident-a", generateBrief });
    expect(generateBrief.mock.calls[0][0].evidence).toHaveLength(1);
    expect(generateBrief.mock.calls[0][0].evidence[0].id).toBe(row.id);
    expect(result).toMatchObject({ success: true, evidenceCount: 1, connectorEvidenceCount: 1 });
    expect(mockLimit).toHaveBeenCalledWith(100);
    const query = new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0]);
    expect(query.params).toEqual(["org-a", "project-a", "incident-a", "2026-09-08T08:00:00.000Z", "2026-09-08T09:10:00.000Z"]);
  });

  it("reports zero used items when no evidence qualifies for the incident window", async () => {
    mockLimit.mockResolvedValue([]);
    const generateBrief = jest.fn().mockResolvedValue({ provider: "fallback", summary: "No evidence", modelId: "test-model", confidenceScore: 0.2, suspectedFailureDomain: "Unknown", citedEvidenceIds: [] });
    expect(await runSreEvidenceBriefGeneration({ userId: "user-a", organizationId: "org-a", projectId: "project-a", incidentId: "incident-a", generateBrief })).toMatchObject({ success: true, evidenceCount: 0, connectorEvidenceCount: 0 });
    expect(generateBrief.mock.calls[0][0].evidence).toEqual([]);
  });
});

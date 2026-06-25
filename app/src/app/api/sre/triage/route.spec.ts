/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/ai/ai-provider", () => ({
  getActualModelName: jest.fn(() => "test-model"),
}));

jest.mock("@/sre/lib/agent-runner", () => ({
  runSreAgent: jest.fn(),
}));

jest.mock("@/sre/tools/evidence-tools", () => ({
  createSreEvidenceTools: jest.fn(() => ({ listNativeEvidence: {}, listConnectorEvidence: {} })),
}));

jest.mock("@/sre/agents/triage", () => ({
  buildSreTriageSystemPrompt: jest.fn(() => "triage system"),
  buildSreTriagePrompt: jest.fn(() => "triage prompt"),
}));

import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    transaction: jest.Mock;
  };
};
const { requireProjectContext: mockRequireProjectContext } = jest.requireMock("@/lib/project-context") as {
  requireProjectContext: jest.Mock;
};
const { checkPermissionWithContext: mockCheckPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
};
const { runSreAgent: mockRunSreAgent } = jest.requireMock("@/sre/lib/agent-runner") as {
  runSreAgent: jest.Mock;
};
const { createSreEvidenceTools: mockCreateSreEvidenceTools } = jest.requireMock("@/sre/tools/evidence-tools") as {
  createSreEvidenceTools: jest.Mock;
};

const originalTriageFlag = process.env.SRE_TRIAGE_AGENT_ENABLED;

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod", organizationId: "018f0000-0000-7000-8000-000000000002" },
};

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/sre/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockIncidentSelect(rows: Array<Record<string, unknown>>) {
  const limit = jest.fn().mockResolvedValue(rows);
  const groupBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ groupBy }));
  const leftJoinEvidence = jest.fn(() => ({ where }));
  const leftJoinServices = jest.fn(() => ({ leftJoin: leftJoinEvidence }));
  const from = jest.fn(() => ({ leftJoin: leftJoinServices }));
  mockDb.select.mockReturnValueOnce({ from });
}

function mockRunInsert(run: Record<string, unknown>) {
  const returning = jest.fn().mockResolvedValue([run]);
  const values = jest.fn(() => ({ returning }));
  mockDb.insert.mockReturnValueOnce({ values });
}

function mockFailedRunUpdate() {
  const where = jest.fn().mockResolvedValue([]);
  const set = jest.fn(() => ({ where }));
  mockDb.update.mockReturnValueOnce({ set });
  return set;
}

function mockSuccessTransaction() {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  mockDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const tx = {
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        }),
      })),
      insert: jest.fn(() => ({
        values: jest.fn((values: Record<string, unknown>) => {
          inserts.push(values);
          return Promise.resolve([]);
        }),
      })),
    };
    await callback(tx);
  });
  return { updates, inserts };
}

describe("SRE triage API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SRE_TRIAGE_AGENT_ENABLED = "true";
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockRunSreAgent.mockResolvedValue({ text: "Likely dependency latency", modelId: "test-model", finishReason: "stop" });
  });

  afterAll(() => {
    if (originalTriageFlag === undefined) {
      delete process.env.SRE_TRIAGE_AGENT_ENABLED;
    } else {
      process.env.SRE_TRIAGE_AGENT_ENABLED = originalTriageFlag;
    }
  });

  it("returns 404 without touching auth or database when disabled", async () => {
    process.env.SRE_TRIAGE_AGENT_ENABLED = "false";

    const response = await POST(request({ incidentId: "018f0000-0000-7000-8000-000000000004" }));

    expect(response.status).toBe(404);
    expect(mockRequireProjectContext).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("rejects users without incident or investigation permissions before database writes", async () => {
    mockCheckPermissionWithContext
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await POST(request({ incidentId: "018f0000-0000-7000-8000-000000000004" }));

    expect(response.status).toBe(403);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON as a bad request", async () => {
    const response = await POST(new NextRequest("http://localhost/api/sre/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    }));

    expect(response.status).toBe(400);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("runs read-only stored-evidence triage and records the result", async () => {
    const incidentId = "018f0000-0000-7000-8000-000000000004";
    const runId = "018f0000-0000-7000-8000-000000000005";
    mockIncidentSelect([{
      id: incidentId,
      title: "Checkout latency",
      severity: "sev2",
      status: "triggered",
      primaryServiceId: "018f0000-0000-7000-8000-000000000006",
      primaryServiceName: "checkout",
      evidenceCount: 2,
      connectorEvidenceCount: 1,
    }]);
    mockRunInsert({ id: runId });
    const transaction = mockSuccessTransaction();

    const response = await POST(request({ incidentId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      investigationRunId: runId,
      summary: "Likely dependency latency",
      modelId: "test-model",
      finishReason: "stop",
    });
    expect(mockCreateSreEvidenceTools).toHaveBeenCalledWith({
      organizationId: context.organizationId,
      projectId: context.project.id,
      incidentId,
    });
    expect(mockRunSreAgent).toHaveBeenCalledWith(expect.objectContaining({
      system: "triage system",
      prompt: "triage prompt",
      tools: { listNativeEvidence: {}, listConnectorEvidence: {} },
    }));
    expect(transaction.updates[0]).toEqual(expect.objectContaining({ status: "completed", rootCauseHypothesis: "Likely dependency latency" }));
    expect(transaction.updates[1]).toEqual(expect.objectContaining({ triageInvestigationRunId: runId }));
    expect(transaction.inserts[0]).toEqual(expect.objectContaining({
      incidentId,
      eventType: "ai_finding",
      actorType: "agent",
      agentRunId: runId,
    }));
  });

  it("marks the investigation run failed when the agent fails", async () => {
    const incidentId = "018f0000-0000-7000-8000-000000000004";
    const runId = "018f0000-0000-7000-8000-000000000005";
    mockIncidentSelect([{
      id: incidentId,
      title: "Checkout latency",
      severity: "sev2",
      status: "triggered",
      primaryServiceId: null,
      primaryServiceName: null,
      evidenceCount: 0,
      connectorEvidenceCount: 0,
    }]);
    mockRunInsert({ id: runId });
    mockRunSreAgent.mockRejectedValueOnce(new Error("provider unavailable"));
    const setFailedValues = mockFailedRunUpdate();

    const response = await POST(request({ incidentId }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "SRE triage failed", investigationRunId: runId });
    expect(setFailedValues).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      agentStateSnapshot: { mode: "sre_triage_api", error: "provider unavailable" },
    }));
  });
});

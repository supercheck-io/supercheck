jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock("@/sre/lib/agent-runner", () => ({ runSreAgent: jest.fn() }));
jest.mock("@/lib/sre/investigation-billing", () => ({
  withSreInvestigationAdmission: jest.fn((_organizationId, createRun) => createRun(jest.requireMock("@/utils/db").db)),
  consumeSreInvestigationCredit: jest.fn(),
  SreInvestigationBillingError: class extends Error {},
}));
jest.mock("@/sre/tools/evidence-tools", () => ({
  listStoredSreEvidence: jest.fn().mockResolvedValue([]),
  createSreEvidenceTools: jest.fn().mockReturnValue({}),
}));

jest.mock("@/lib/ai/ai-provider", () => ({
  getActualModelName: jest.fn(() => "test-model"),
}));

import { db } from "@/utils/db";
import {
  startSreIncidentInvestigation,
  executeSreIncidentInvestigation,
  completeSreIncidentInvestigation,
} from "./investigation-runner";
import { runSreAgent } from "./agent-runner";
import { consumeSreInvestigationCredit } from "@/lib/sre/investigation-billing";

const incident = {
  id: "018f0000-0000-7000-8000-000000000005",
  title: "Checkout latency",
  severity: "sev1",
  status: "investigating",
  primaryServiceId: null,
  primaryServiceName: null,
  evidenceCount: 1,
  connectorEvidenceCount: 0,
};

const input = {
  organizationId: "018f0000-0000-7000-8000-000000000002",
  projectId: "018f0000-0000-7000-8000-000000000003",
  userId: "018f0000-0000-7000-8000-000000000001",
  incidentId: incident.id,
};

function mockIncidentLookup() {
  const chain = {
    from: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    limit: jest.fn().mockResolvedValue([incident]),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  (db.select as jest.Mock).mockReturnValue(chain);
}

function mockInsertFailure(error: unknown) {
  const returning = jest.fn().mockRejectedValue(error);
  const values = jest.fn().mockReturnValue({ returning });
  (db.insert as jest.Mock).mockReturnValue({ values });
}

describe("startSreIncidentInvestigation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncidentLookup();
  });

  it("returns 409 when the database guard rejects a concurrent active run", async () => {
    mockInsertFailure({
      cause: {
        code: "23505",
        constraint_name: "sre_investigation_runs_active_incident_unique",
      },
    });

    await expect(startSreIncidentInvestigation(input)).resolves.toEqual({
      success: false,
      status: 409,
      error: "An investigation is already running for this incident",
    });
  });

  it("does not disguise unrelated unique violations as active-run conflicts", async () => {
    const error = {
      code: "23505",
      constraint: "some_other_unique_constraint",
    };
    mockInsertFailure(error);

    await expect(startSreIncidentInvestigation(input)).rejects.toBe(error);
  });
});

describe("executeSreIncidentInvestigation failure persistence", () => {
  it("does not publish success after recovery has released the reservation", async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
    const values = jest.fn().mockResolvedValue([]);
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: jest.fn().mockReturnValue({ set }), insert: jest.fn().mockReturnValue({ values }),
    }));
    (runSreAgent as jest.Mock).mockResolvedValue({ text: "late result", modelId: "test-model", finishReason: "stop" });
    const result = await executeSreIncidentInvestigation("run-1", incident, input);
    expect(result.success).toBe(false);
    expect(returning).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ rootCauseSummary: "late result" }));
  });

  it("does not persist provider secrets in failed runs or timeline events", async () => {
    const set = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue([]) });
    const values = jest.fn().mockResolvedValue([]);
    (db.transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        update: jest.fn().mockReturnValue({ set }),
        insert: jest.fn().mockReturnValue({ values }),
      }),
    );
    (runSreAgent as jest.Mock).mockRejectedValue(
      new Error(
        'Provider response: {"api_key":"fixture-secret", "rawEvidence":"private-payload"}',
      ),
    );

    const result = await executeSreIncidentInvestigation(
      "run-1",
      incident,
      input,
    );

    expect(result).toMatchObject({ success: false, status: 502 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        agentStateSnapshot: {
          mode: "sre_investigation_api",
          error: "SRE investigation failed",
        },
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventData: expect.objectContaining({
          error: "SRE investigation failed",
        }),
      }),
    );
    expect(
      JSON.stringify([set.mock.calls, values.mock.calls, result]),
    ).not.toMatch(/fixture-secret|private-payload/);
  });
});

describe("completeSreIncidentInvestigation", () => {
  const mockConsume = consumeSreInvestigationCredit as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not bill a failed execution", async () => {
    const set = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue([]) });
    const values = jest.fn().mockResolvedValue([]);
    (db.transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        update: jest.fn().mockReturnValue({ set }),
        insert: jest.fn().mockReturnValue({ values }),
      }),
    );
    (runSreAgent as jest.Mock).mockRejectedValue(new Error("provider down"));

    const result = await completeSreIncidentInvestigation("run-1", incident, input);

    expect(result.success).toBe(false);
    expect(mockConsume).not.toHaveBeenCalled();
  });
});

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("@/lib/ai/ai-provider", () => ({
  getActualModelName: jest.fn(() => "test-model"),
}));

import { db } from "@/utils/db";
import { startSreIncidentInvestigation } from "./investigation-runner";

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

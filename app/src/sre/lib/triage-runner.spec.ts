/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));
jest.mock("@/lib/ai/ai-provider", () => ({ getActualModelName: () => "test-model" }));
jest.mock("@/sre/lib/agent-runner", () => ({ runSreAgent: jest.fn() }));
jest.mock("@/sre/tools/evidence-tools", () => ({ createSreEvidenceTools: jest.fn() }));

import { db } from "@/utils/db";
import { runSreAgent } from "./agent-runner";
import { runSreIncidentTriage } from "./triage-runner";

describe("incident triage admission", () => {
  const input = { organizationId: "org", projectId: "project", userId: "user", incidentId: "incident" };
  beforeEach(() => {
    jest.clearAllMocks();
    const chain = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ id: input.incidentId }]),
    };
    (db.select as jest.Mock).mockReturnValue(chain);
  });

  it("returns 409 for the active-incident database constraint before calling the provider", async () => {
    (db.insert as jest.Mock).mockReturnValue({ values: () => ({ returning: async () => {
      throw { cause: { code: "23505", constraint_name: "sre_investigation_runs_active_incident_unique" } };
    } }) });
    await expect(runSreIncidentTriage(input)).resolves.toMatchObject({ success: false, status: 409 });
    expect(runSreAgent).not.toHaveBeenCalled();
  });

  it("does not hide unrelated database failures as conflicts", async () => {
    const error = new Error("database unavailable");
    (db.insert as jest.Mock).mockReturnValue({ values: () => ({ returning: async () => { throw error; } }) });
    await expect(runSreIncidentTriage(input)).rejects.toBe(error);
    expect(runSreAgent).not.toHaveBeenCalled();
  });
});

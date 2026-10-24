/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));
jest.mock("@/lib/ai/ai-provider", () => ({ getActualModelName: () => "test-model" }));
jest.mock("@/sre/lib/agent-runner", () => ({ runSreAgent: jest.fn() }));
jest.mock("@/sre/tools/evidence-tools", () => ({ createSreEvidenceTools: jest.fn() }));
const withSreTriageAdmission = jest.fn();
let admissionTier: "paid" | "trial" = "paid";
jest.mock("@/lib/sre/investigation-billing", () => ({
  ...jest.requireActual("@/lib/sre/investigation-billing"),
  withSreTriageAdmission: (...args: unknown[]) => withSreTriageAdmission(...args),
}));

import { db } from "@/utils/db";
import { runSreAgent } from "./agent-runner";
import { SreInvestigationBillingError } from "@/lib/sre/investigation-billing";
import { runSreIncidentTriage } from "./triage-runner";

describe("incident triage admission", () => {
  const input = { organizationId: "org", projectId: "project", userId: "user", incidentId: "incident" };
  beforeEach(() => {
    jest.clearAllMocks();
    // Run the insert callback the way the real admission would, under the chosen tier.
    admissionTier = "paid";
    withSreTriageAdmission.mockImplementation(async (_org: string, create: (database: typeof db, tier: "paid" | "trial") => unknown) => create(db, admissionTier));
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

  it("answers 402 without starting a run once a trial has used its triage runs", async () => {
    withSreTriageAdmission.mockRejectedValue(new SreInvestigationBillingError("Your trial includes 20 AI triage runs and they are used. Subscribe to continue.", "trial_limit"));
    await expect(runSreIncidentTriage(input)).resolves.toMatchObject({ success: false, status: 402 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(runSreAgent).not.toHaveBeenCalled();
  });

  it("records the tier the run was admitted under", async () => {
    admissionTier = "trial";
    const values = jest.fn(() => ({ returning: async () => { throw new Error("stop after insert"); } }));
    (db.insert as jest.Mock).mockReturnValue({ values });
    await expect(runSreIncidentTriage(input)).rejects.toThrow("stop after insert");
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ agentType: "triage", billingTier: "trial" }));
  });
});

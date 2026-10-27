/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";

const returning = jest.fn();
const where = jest.fn((_c: unknown) => ({ returning }));
const set = jest.fn((_v: unknown) => ({ where }));
jest.mock("@/utils/db", () => ({ db: { update: () => ({ set }) } }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));

import { failStaleSreInvestigationRunsForIncident } from "./stale-run-recovery";

describe("failStaleSreInvestigationRunsForIncident", () => {
  beforeEach(() => { jest.clearAllMocks(); returning.mockResolvedValue([]); });

  it("only fails old running runs of this incident in this organization and project", async () => {
    const before = Date.now();
    await failStaleSreInvestigationRunsForIncident({ organizationId: "org-a", projectId: "proj-a", incidentId: "inc-a" });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0] as never);
    expect(query.sql).toContain('"status" = $');
    expect(query.sql).toContain('"started_at" < $');
    expect(query.params).toEqual(expect.arrayContaining(["org-a", "proj-a", "inc-a", "running"]));
    const cutoff = new Date(query.params.find((p) => typeof p === "string" && /^\d{4}-/.test(p)) as string).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      agentStateSnapshot: expect.objectContaining({ errorCode: "stale_run" }),
    }));
  });
});

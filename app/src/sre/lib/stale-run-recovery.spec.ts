/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";

const returning = jest.fn();
const where = jest.fn((_c: unknown) => ({ returning }));
const limit = jest.fn((_n: number) => "stale-ids-subquery");
const select = jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
const set = jest.fn((_v: unknown) => ({ where }));
jest.mock("@/utils/db", () => ({ db: { select: () => select(), update: () => ({ set }) } }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));

import { failStaleSreInvestigationRunsForIncident, failStaleSreRuns } from "./stale-run-recovery";

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

  it("clamps the recorded duration to the integer column before the cast", async () => {
    await failStaleSreInvestigationRunsForIncident({ organizationId: "o", projectId: "p", incidentId: "i" });
    const { durationMs } = set.mock.calls[0][0] as { durationMs: never };
    expect(new PgDialect().sqlToQuery(durationMs).sql).toMatch(/LEAST\(2147483647, GREATEST\(0, .*\)\)\)::integer/);
  });
});

describe("failStaleSreRuns", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("fails stale running runs of any incident and origin, re-checking the guard, and returns the count", async () => {
    returning.mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
    expect(await failStaleSreRuns(10)).toBe(2);
    expect(limit).toHaveBeenCalledWith(10);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0] as never);
    expect(query.sql).toContain('"status" = $');
    expect(query.sql).toContain('"started_at" < $');
    expect(query.params).toContain("running");
    expect(query.sql).not.toContain("incident_id");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      agentStateSnapshot: expect.objectContaining({ errorCode: "stale_run" }),
    }));
  });

  it("returns 0 when nothing is stale", async () => {
    returning.mockResolvedValue([]);
    expect(await failStaleSreRuns()).toBe(0);
  });
});

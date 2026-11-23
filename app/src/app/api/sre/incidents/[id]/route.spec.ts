/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

let rows: unknown[] = [];
const where = jest.fn();
const chain: Record<string, jest.Mock> = {};
for (const name of ["from", "leftJoin", "limit"]) chain[name] = jest.fn(() => chain);
chain.where = where.mockImplementation(() => chain);
// limit is the terminal call
chain.limit = jest.fn(async () => rows);
jest.mock("@/utils/db", () => ({ db: { select: () => chain } }));
let allowed = true;
jest.mock("../../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () =>
    allowed
      ? { success: true, context: { organizationId: "org-1", project: { id: "project-1" } } }
      : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));
import { requireSreApiPermissions } from "../../_auth";
import { GET } from "./route";

const id = "018f0000-0000-7000-8000-0000000000d1";
const call = (value = id) => GET(new NextRequest("https://example.com/x"), { params: Promise.resolve({ id: value }) });

beforeEach(() => {
  allowed = true;
  rows = [];
  jest.clearAllMocks();
});

describe("GET /api/sre/incidents/[id]", () => {
  it("requires sre_incident view and reads nothing when denied", async () => {
    allowed = false;
    expect((await call()).status).toBe(403);
    expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_incident", action: "view" }]);
    expect(where).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    expect((await call("nope")).status).toBe(400);
  });

  it("returns the incident with a user-facing status label", async () => {
    rows = [{ id, incidentNumber: 4, status: "investigating", acknowledgedAt: null, rootCauseSummary: null }];
    const response = await call();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.incident).toMatchObject({ id, incidentNumber: 4, status: "investigating" });
    expect(typeof body.incident.statusLabel).toBe("string");
  });

  it("scopes by organization and project, so another project's incident is a 404", async () => {
    const response = await call();
    expect(response.status).toBe(404);
    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([id, "org-1", "project-1"]);
  });
});

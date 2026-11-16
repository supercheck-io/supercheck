/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

let allowed = true;
const requirePermissions = jest.fn();
jest.mock("../../../_auth", () => ({
  requireSreApiPermissions: (...args: unknown[]) => {
    requirePermissions(...args);
    return allowed
      ? { success: true, context: { organizationId: "org-1", userId: "user-1", project: { id: "project-1" } } }
      : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: allowedStatus }) };
  },
}));
let allowedStatus = 403;
let rows: unknown[] = [];
const where = jest.fn();
jest.mock("@/utils/db", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = (w: unknown) => { where(w); return chain; };
  chain.limit = async () => rows;
  return { db: chain };
});

import { GET } from "./route";

const id = "018f0000-0000-7000-8000-0000000000d1";
const call = (rawId = id) => GET(new NextRequest("https://example.com/x"), { params: Promise.resolve({ id: rawId }) });

beforeEach(() => {
  jest.clearAllMocks();
  allowed = true;
  allowedStatus = 403;
  rows = [];
});

describe("GET /api/sre/incidents/[id]/postmortem", () => {
  it("returns the sections and rendered markdown when allowed", async () => {
    rows = [{ incidentNumber: 7, title: "Checkout down", postmortem: { sections: { summary: "It broke." }, generatedAt: "2026-11-01T00:00:00Z" } }];
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(requirePermissions).toHaveBeenCalledWith([{ resource: "sre_incident", action: "view" }]);
    expect(body.postmortem).toEqual({ sections: { summary: "It broke." }, generatedAt: "2026-11-01T00:00:00Z", updatedAt: null });
    expect(body.markdown).toContain("# Post-mortem: Incident #7 - Checkout down");
    expect(body.markdown).toContain("It broke.");
  });

  it("returns null postmortem and markdown when none was written", async () => {
    rows = [{ incidentNumber: 7, title: "t", postmortem: null }];
    expect(await (await call()).json()).toEqual({ success: true, postmortem: null, markdown: null });
  });

  it.each([[403, "denied"], [401, "unauthenticated"]])("returns %s when %s, before any query", async (status) => {
    allowed = false;
    allowedStatus = status;
    expect((await call()).status).toBe(status);
    expect(where).not.toHaveBeenCalled();
  });

  it("rejects a malformed id with 400 before any query", async () => {
    expect((await call("nope")).status).toBe(400);
    expect(where).not.toHaveBeenCalled();
  });

  it("scopes the query by id, organization and project, so another tenant's incident is a 404", async () => {
    const res = await call();
    expect(res.status).toBe(404);
    const q = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(q.sql).toMatch(/"organization_id" = \$/);
    expect(q.sql).toMatch(/"project_id" = \$/);
    expect(q.params).toEqual([id, "org-1", "project-1"]);
  });
});

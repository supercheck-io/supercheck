/** @jest-environment node */
import { NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

let rows: unknown[] = [];
const where = jest.fn();
const chain: Record<string, jest.Mock> = {};
chain.from = jest.fn(() => chain);
chain.where = where.mockImplementation(() => chain);
chain.orderBy = jest.fn(() => chain);
chain.limit = jest.fn(async () => rows);
jest.mock("@/utils/db", () => ({ db: { select: () => chain } }));
let allowed = true;
jest.mock("../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () =>
    allowed
      ? { success: true, context: { organizationId: "org-1", project: { id: "project-1" } } }
      : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));
import { requireSreApiPermissions } from "../_auth";
import { GET } from "./route";

beforeEach(() => {
  allowed = true;
  rows = [];
  jest.clearAllMocks();
});

describe("GET /api/sre/services", () => {
  it("requires sre_service view and reads nothing when denied", async () => {
    allowed = false;
    expect((await GET()).status).toBe(403);
    expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_service", action: "view" }]);
    expect(where).not.toHaveBeenCalled();
  });

  it("lists only this organization's project services, excluding merged ones", async () => {
    rows = [{ id: "s1", name: "api" }];
    const response = await GET();
    expect(await response.json()).toEqual({ success: true, services: [{ id: "s1", name: "api" }], truncated: false });
    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual(["org-1", "project-1", "merged"]);
  });

  it("caps at 500 and reports truncation", async () => {
    rows = Array.from({ length: 501 }, (_, i) => ({ id: `s${i}` }));
    const body = await (await GET()).json();
    expect(body.services).toHaveLength(500);
    expect(body.truncated).toBe(true);
  });
});

/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

let serviceRows: unknown[] = [];
const where = jest.fn();
const chain: Record<string, jest.Mock> = {};
chain.from = jest.fn(() => chain);
chain.where = where.mockImplementation(() => chain);
chain.orderBy = jest.fn(() => chain);
// First select (service) ends at limit; dependency select also ends at limit.
chain.limit = jest.fn(async () => serviceRows);
const findHealth = jest.fn(async () => undefined);
jest.mock("@/utils/db", () => ({
  db: { select: () => chain, query: { sreServiceHealthSnapshots: { findFirst: () => findHealth() } } },
}));
let allowed = true;
jest.mock("../../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () =>
    allowed
      ? { success: true, context: { organizationId: "org-1", project: { id: "project-1" } } }
      : { success: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }),
}));
import { requireSreApiPermissions } from "../../_auth";
import { GET } from "./route";

const id = "018f0000-0000-7000-8000-0000000000a1";
const call = (value = id) => GET(new NextRequest("https://example.com/x"), { params: Promise.resolve({ id: value }) });

beforeEach(() => {
  allowed = true;
  serviceRows = [];
  jest.clearAllMocks();
});

describe("GET /api/sre/services/[id]", () => {
  it("requires sre_service view and reads nothing when denied", async () => {
    allowed = false;
    expect((await call()).status).toBe(403);
    expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_service", action: "view" }]);
    expect(where).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    expect((await call("nope")).status).toBe(400);
  });

  it("returns 404 for a service outside this organization and project", async () => {
    expect((await call()).status).toBe(404);
    expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([id, "org-1", "project-1"]);
    expect(findHealth).not.toHaveBeenCalled();
  });

  it("returns the service with its health and dependencies", async () => {
    serviceRows = [{ id, name: "api" }];
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, service: { id, name: "api" }, health: null });
  });
});

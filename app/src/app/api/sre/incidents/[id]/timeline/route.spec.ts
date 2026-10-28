/** @jest-environment node */

import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const mockRequirePermissions = jest.fn();
const mockOrderBy = jest.fn();
let mockEventRows: unknown[] = [];

jest.mock("../../../_auth", () => ({
  requireSreApiPermissions: (...args: unknown[]) => mockRequirePermissions(...args),
}));
jest.mock("@/utils/db", () => ({
  db: {
    select: (fields?: unknown) => {
      const incidentLookup = Boolean(fields);
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: (order: unknown) => { mockOrderBy(order); return chain; },
        limit: async () => (incidentLookup ? [{ id: "i" }] : mockEventRows),
      };
      return chain;
    },
  },
}));

import { GET } from "./route";

const incidentId = "018f0000-0000-7000-8000-000000000004";

describe("GET /api/sre/incidents/[id]/timeline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequirePermissions.mockResolvedValue({
      success: true,
      context: { organizationId: "o", project: { id: "p" } },
    });
  });

  it("selects the newest events but returns them oldest first", async () => {
    mockEventRows = [{ id: "e3" }, { id: "e2" }, { id: "e1" }]; // as a newest-first query returns them
    const response = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: incidentId }) });
    const body = await response.json();
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["e1", "e2", "e3"]);
    const order = new PgDialect().sqlToQuery(mockOrderBy.mock.calls.at(-1)![0]).sql;
    expect(order).toMatch(/desc/i);
  });
});

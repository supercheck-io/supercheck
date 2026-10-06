/** @jest-environment node */
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "./route";

const mockWhere = jest.fn();
const mockSelect = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...args: unknown[]) => mockSelect(...args) } }));
jest.mock("../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () => ({
    success: true,
    context: { organizationId: "org-1", project: { id: "project-1" } },
  })),
}));

describe("incident number lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const query = {
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: mockWhere.mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ id: "incident-uuid", incidentNumber: 42 }]),
    };
    mockSelect.mockReturnValue(query);
  });

  it("filters by incident number together with organization and project before the result limit", async () => {
    const response = await GET(new NextRequest("https://example.com/api/sre/incidents?incidentNumber=42"));
    expect(response.status).toBe(200);
    const query = new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0]);
    expect(query.params).toEqual(["org-1", "project-1", 42]);
    expect(await response.json()).toEqual({ success: true, incidents: [{ id: "incident-uuid", incidentNumber: 42 }] });
  });

  it.each(["0", "-1", "1.5", "abc", "2147483648", "9007199254740992"])("rejects invalid incident number %s before querying", async (number) => {
    const response = await GET(new NextRequest(`https://example.com/api/sre/incidents?incidentNumber=${number}`));
    expect(response.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

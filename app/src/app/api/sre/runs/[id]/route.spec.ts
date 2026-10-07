/** @jest-environment node */
import { NextRequest, NextResponse } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "./route";
import { requireSreApiPermissions } from "../../_auth";
const mockWhere = jest.fn();
const mockSelect = jest.fn();
const mockLimit = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...args: unknown[]) => mockSelect(...args) } }));
jest.mock("../../_auth", () => ({ requireSreApiPermissions: jest.fn() }));
const runId = "019a0000-0000-7000-8000-000000000001";
const request = new NextRequest(`https://example.com/api/sre/runs/${runId}`);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireSreApiPermissions).mockResolvedValue({ success: true, context: { organizationId: "org-1", project: { id: "project-1" } } } as Awaited<ReturnType<typeof requireSreApiPermissions>>);
  mockLimit.mockResolvedValue([{ id: runId, status: "running" }]);
  mockSelect.mockReturnValue({ from: jest.fn().mockReturnThis(), where: mockWhere.mockReturnThis(), limit: mockLimit });
});

it("requires view permission and scopes status by run, organization, and project", async () => {
  const response = await GET(request, { params: Promise.resolve({ id: runId }) });
  expect(requireSreApiPermissions).toHaveBeenCalledWith([{ resource: "sre_investigation", action: "view" }]);
  expect(new PgDialect().sqlToQuery(mockWhere.mock.calls[0][0]).params).toEqual([runId, "org-1", "project-1"]);
  const fields = Object.keys(mockSelect.mock.calls[0][0]);
  expect(fields).not.toContain("agentStateSnapshot");
  expect(fields).not.toContain("promptInput");
  expect(await response.json()).toEqual({ run: { id: runId, status: "running" } });
});
it("returns 404 when no scoped run exists", async () => {
  mockLimit.mockResolvedValue([]);
  expect((await GET(request, { params: Promise.resolve({ id: runId }) })).status).toBe(404);
});
it("rejects malformed IDs before reading the database", async () => {
  expect((await GET(request, { params: Promise.resolve({ id: "bad" }) })).status).toBe(400);
  expect(mockSelect).not.toHaveBeenCalled();
});
it("returns authorization failures before reading runs", async () => {
  jest.mocked(requireSreApiPermissions).mockResolvedValue({ success: false, response: new NextResponse("Denied", { status: 403 }) });
  expect((await GET(request, { params: Promise.resolve({ id: runId }) })).status).toBe(403);
  expect(mockSelect).not.toHaveBeenCalled();
});

/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: jest.fn() } }, update: jest.fn() } }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(async () => ({ userId: "user" })) }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { PATCH } from "./route";

it.each([{ organizationId: null, projectId: "project" }, { organizationId: "org", projectId: null }])("does not mutate a monitor with missing scope", async (scope) => {
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue({ id: "monitor", ...scope } as never);
  const response = await PATCH(new NextRequest("http://localhost/api/monitors/monitor/status", { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), { params: Promise.resolve({ id: "monitor" }) });
  expect(response.status).toBe(404);
  expect(db.update).not.toHaveBeenCalled();
});

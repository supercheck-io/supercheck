/** @jest-environment node */
// Soft-deleted projects must not consume the plan's project limit.
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/session", () => ({ getSelectableProjects: jest.fn(), getUserProjects: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ getCurrentProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn(async () => true), getUserRole: jest.fn(async () => "org_owner") }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/project-member-counts", () => ({ withMemberCounts: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkProjectLimit: jest.fn() }));
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ insertWithinPlanLimit: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn() },
  SubscriptionAccessDeniedError: class extends Error {},
}));
import { POST } from "./route";
import { requireUserAuthContext } from "@/lib/auth-context";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";

it("counts only non-deleted projects against the plan limit", async () => {
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u", organizationId: "org", isCliAuth: false });
  let countSql = "";
  (insertWithinPlanLimit as jest.Mock).mockImplementation(async ({ countRows }) => {
    const where = (w: SQL) => { countSql = new PgDialect().sqlToQuery(w).sql; return Promise.resolve([{ count: 0 }]); };
    await countRows({ select: () => ({ from: () => ({ where }) }) });
    throw new Error("stop");
  });
  await POST(new NextRequest("http://localhost/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "P" }) }));
  expect(countSql).toContain('"status"');
});

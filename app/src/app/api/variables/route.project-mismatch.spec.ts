/**
 * Setup sends the project it is working on as `x-supercheck-project-id`. When another tab switched
 * the active project, the write is refused with 409 PROJECT_MISMATCH before anything is stored.
 */
jest.mock("next/headers", () => ({ headers: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: jest.fn() }));
jest.mock("@/lib/rbac/unified-auth", () => ({ getUnifiedAuthContext: jest.fn() }));
jest.mock("@/lib/deletion/org-state", () => ({ isOrgPendingDeletion: jest.fn().mockResolvedValue(false), permissionDeniedResponse: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));

import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getCachedAuthSession } from "@/lib/session-cache";
import { getUnifiedAuthContext } from "@/lib/rbac/unified-auth";
import { db } from "@/utils/db";
import { POST } from "./route";

describe("POST /api/variables expected project", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCachedAuthSession as jest.Mock).mockResolvedValue({ session: { token: "t" }, user: { id: "u1" } });
    (getUnifiedAuthContext as jest.Mock).mockResolvedValue({
      isValid: true, userId: "u1", projectId: "project-a", projectName: "A", organizationId: "org-1", organizationRole: "org_owner", projectRole: null,
    });
  });

  const call = (expected?: string) => {
    (headers as jest.Mock).mockResolvedValue({ get: (name: string) => (name === "x-supercheck-project-id" ? (expected ?? null) : null) });
    return POST(new NextRequest("http://localhost/api/variables", { method: "POST", body: "{}" }));
  };

  it("answers 409 PROJECT_MISMATCH and writes nothing when the active project differs", async () => {
    const res = await call("project-b");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Project changed in another tab", code: "PROJECT_MISMATCH" });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not answer 409 when the expected project is the active one", async () => {
    const res = await call("project-a");
    expect(res.status).not.toBe(409);
  });
});

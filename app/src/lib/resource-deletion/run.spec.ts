/** @jest-environment node */
import { deleteRunWithContext } from "./run";
import { db } from "@/utils/db";
import type { ProjectAuthContext } from "@/lib/project-context";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), transaction: jest.fn() } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn().mockReturnValue(true) }));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: jest.fn() }));

const context = { userId: "user-1234567890", organizationId: "org-1234567890", project: { id: "p1", name: "P" } } as unknown as ProjectAuthContext;

describe("deleteRunWithContext error handling", () => {
  it("does not return raw database error text to the client", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(db.select).mockImplementation(() => { throw new Error("connection to 10.0.0.5:5432 refused"); });
    const result = await deleteRunWithContext("run-1", context);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain("10.0.0.5");
    expect(console.error).toHaveBeenCalled();
  });
});

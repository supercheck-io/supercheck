/** @jest-environment node */
import { GET } from "./route";
import { getQueueStats } from "@/lib/queue-stats";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/queue-stats", () => ({ getQueueStats: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(async () => ({ organizationId: "org-a", project: { id: "project-a" } })),
  isAuthError: jest.fn(() => false),
}));

describe("dashboard queue scope", () => {
  beforeEach(() => { jest.clearAllMocks(); });
  it("requests only the authenticated organization's queue statistics", async () => {
    jest.mocked(getQueueStats).mockRejectedValueOnce(new Error("queue unavailable"));
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await GET()).status).toBe(500);
      expect(getQueueStats).toHaveBeenCalledWith("org-a");
    } finally { log.mockRestore(); }
  });
  it("denies access before reading queue statistics", async () => {
    jest.mocked(checkPermissionWithContext).mockReturnValueOnce(false);
    expect((await GET()).status).toBe(403);
    expect(getQueueStats).not.toHaveBeenCalled();
  });
});

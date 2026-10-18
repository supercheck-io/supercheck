jest.mock("@/lib/test-results-access", () => ({ resolveAccessContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("./ai-rate-limiter", () => ({ aiRateLimiter: {} }));
import { AuthService } from "./ai-security";
import { resolveAccessContext } from "@/lib/test-results-access";
import { hasPermissionForUser } from "@/lib/rbac/middleware";

const session = { user: { id: "user", email: "user@example.test", organizationId: "org" } };
describe("AI report access", () => {
  beforeEach(() => jest.resetAllMocks());
  it.each([null, { organizationId: "org", projectId: null }, { organizationId: null, projectId: "project" }])(
    "rejects missing and unscoped artifacts before checking permissions", async (context) => {
      jest.mocked(resolveAccessContext).mockResolvedValue(context);
      expect(await AuthService.canAccessTestReport(session, "ephemeral-id", "browser")).toBe(false);
      expect(hasPermissionForUser).not.toHaveBeenCalled();
    },
  );
  it.each(["browser", "performance"])("authorizes %s reports through their actual owner", async (type) => {
    jest.mocked(resolveAccessContext).mockResolvedValue({ organizationId: "org", projectId: "project" });
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    expect(await AuthService.canAccessTestReport(session, "artifact-id", type)).toBe(true);
    expect(resolveAccessContext).toHaveBeenCalledWith("test", "artifact-id");
    expect(hasPermissionForUser).toHaveBeenCalledWith("user", "test", "view", { organizationId: "org", projectId: "project" });
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    expect(await AuthService.canAccessTestReport(session, "artifact-id", type)).toBe(false);
  });
  it("lets a multi-org member reach a report outside their active organization when permitted", async () => {
    jest.mocked(resolveAccessContext).mockResolvedValue({ organizationId: "other-org", projectId: "project" });
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    expect(await AuthService.canAccessTestReport(session, "artifact-id", "browser")).toBe(true);
    expect(hasPermissionForUser).toHaveBeenCalledWith("user", "test", "view", { organizationId: "other-org", projectId: "project" });
  });
  it("denies a foreign organization's report when the user has no membership there", async () => {
    jest.mocked(resolveAccessContext).mockResolvedValue({ organizationId: "foreign", projectId: "project" });
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    expect(await AuthService.canAccessTestReport(session, "artifact-id", "browser")).toBe(false);
  });
});

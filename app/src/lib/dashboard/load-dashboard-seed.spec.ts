/** @jest-environment node */
const mockRequireAuthContext = jest.fn();
const mockCanView = jest.fn();
const mockPayload = jest.fn();
const mockRethrow = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("next/navigation", () => ({ unstable_rethrow: (e: unknown) => mockRethrow(e) }));
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: () => mockRequireAuthContext() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => mockCanView(...a) }));
jest.mock("@/lib/dashboard/get-dashboard-payload", () => ({ getDashboardPayload: (...a: unknown[]) => mockPayload(...a) }));
import { loadDashboardSeed } from "./load-dashboard-seed";

const context = { organizationId: "org-a", project: { id: "project-a" } };

describe("loadDashboardSeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(context);
    mockCanView.mockReturnValue(true);
    mockPayload.mockResolvedValue({ jobs: { recentRuns30d: 4 } });
  });

  it("reads the current project's data with the same access rule as the route", async () => {
    const seed = await loadDashboardSeed();
    expect(mockCanView).toHaveBeenCalledWith("project", "view", context);
    expect(mockPayload).toHaveBeenCalledWith(context);
    expect(seed).toMatchObject({ projectId: "project-a", data: { stats: { runs: 4 } } });
    expect(typeof seed?.updatedAt).toBe("number");
  });

  it("reads nothing without project view access", async () => {
    mockCanView.mockReturnValue(false);
    expect(await loadDashboardSeed()).toBeNull();
    expect(mockPayload).not.toHaveBeenCalled();
  });

  it("resolves to null when signed out", async () => {
    mockRequireAuthContext.mockRejectedValue(Object.assign(new Error("Authentication required"), { name: "AuthError" }));
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDashboardSeed()).toBeNull();
  });

  it("lets Next's own control-flow errors (redirect, dynamic usage) through", async () => {
    const signal = new Error("NEXT_REDIRECT");
    mockRethrow.mockImplementationOnce((e: unknown) => { throw e; });
    mockRequireAuthContext.mockRejectedValue(signal);
    await expect(loadDashboardSeed()).rejects.toBe(signal);
  });

  it("logs a failed query by name and code only, never its parameters", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    mockPayload.mockRejectedValue(Object.assign(new Error("Failed query: select 1\nparams: secret-value"), { code: "57014" }));
    expect(await loadDashboardSeed()).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
    expect(log).toHaveBeenCalledWith("Dashboard seed failed:", "Error", "57014");
  });
});

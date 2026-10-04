import { act, renderHook } from "@testing-library/react";
import { useProjectContextState, clearProjectsCache } from "./use-project-context";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";

jest.mock("@/lib/project-navigation", () => ({
  announceProjectChange: jest.fn(), reloadProjectContext: jest.fn(),
  listenForProjectChanges: jest.fn(() => jest.fn()),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

const project = { id: "project-1", name: "Home", organizationId: "home", isDefault: true, userRole: "org_owner" };

describe("project switching", () => {
  const originalFetch = global.fetch;
  beforeEach(() => { jest.clearAllMocks(); clearProjectsCache(); });
  afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

  it.each([false, true])("clears caches and notifies other tabs after selecting an invited project (storage disabled: %s)", async disabled => {
    const invited = { ...project, id: "invited", organizationId: "team", userRole: "project_editor" };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, project: invited }) });
    if (disabled) jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
    const { result } = renderHook(() => useProjectContextState({ initialProjects: [project, invited], initialCurrentProject: project }));
    let success;
    await act(async () => { success = await result.current.switchProject("invited"); });
    expect(success).toBe(true);
    expect(result.current.currentProject?.organizationId).toBe("team");
    expect(announceProjectChange).toHaveBeenCalledTimes(1);
    expect(reloadProjectContext).toHaveBeenCalledWith(clearProjectsCache);
  });

  it("preserves context and cache after a rejected switch", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Access denied" }) });
    const { result } = renderHook(() => useProjectContextState({ initialProjects: [project], initialCurrentProject: project }));
    await act(async () => { expect(await result.current.switchProject("foreign")).toBe(false); });
    expect(result.current.currentProject).toEqual(project);
    expect(reloadProjectContext).not.toHaveBeenCalled();
    expect(announceProjectChange).not.toHaveBeenCalled();
  });
});

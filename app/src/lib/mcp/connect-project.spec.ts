/** @jest-environment node */
const mockGetSelectable = jest.fn();
jest.mock("@/lib/session", () => ({ getSelectableProjects: (...a: unknown[]) => mockGetSelectable(...a) }));

import {
  McpProjectAccessError,
  assertCanConnectProject,
  resolveConsentProject,
  runWithConsentProject,
} from "./connect-project";

const A = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSelectable.mockResolvedValue([{ id: A }, { id: B }]);
});

describe("assertCanConnectProject", () => {
  it("accepts a project the user can view and refuses any other", async () => {
    await expect(assertCanConnectProject("u1", A)).resolves.toBeUndefined();
    await expect(assertCanConnectProject("u1", "0197a1b2-c3d4-7e5f-8a9b-ffffffffffff")).rejects.toBeInstanceOf(
      McpProjectAccessError,
    );
  });
});

describe("resolveConsentProject", () => {
  it("returns the project of the approval in progress", async () => {
    await expect(runWithConsentProject({ userId: "u1", projectId: A }, () => resolveConsentProject({ userId: "u1" }))).resolves.toBe(A);
  });

  it("returns nothing outside an approval, such as an authorization request only looking up consent", async () => {
    await expect(resolveConsentProject({ userId: "u1" })).resolves.toBeUndefined();
    expect(mockGetSelectable).not.toHaveBeenCalled();
  });

  it("returns nothing for a different user than the one approving", async () => {
    await expect(runWithConsentProject({ userId: "u1", projectId: A }, () => resolveConsentProject({ userId: "u2" }))).resolves.toBeUndefined();
  });

  it("re-checks access, so a user who lost the project cannot be granted it", async () => {
    mockGetSelectable.mockResolvedValue([{ id: B }]);
    await expect(runWithConsentProject({ userId: "u1", projectId: A }, () => resolveConsentProject({ userId: "u1" }))).resolves.toBeUndefined();
  });

  it("surfaces an unexpected failure instead of reading it as 'no project chosen'", async () => {
    mockGetSelectable.mockRejectedValue(new Error("connection timeout"));
    await expect(
      runWithConsentProject({ userId: "u1", projectId: A }, () => resolveConsentProject({ userId: "u1" })),
    ).rejects.toThrow("connection timeout");
  });

  it("keeps concurrent approvals apart, whatever order they resume in", async () => {
    const slowResolve = async (delayMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return resolveConsentProject({ userId: "u1" });
    };
    const [first, second] = await Promise.all([
      runWithConsentProject({ userId: "u1", projectId: A }, () => slowResolve(20)),
      runWithConsentProject({ userId: "u1", projectId: B }, () => slowResolve(1)),
    ]);
    expect([first, second]).toEqual([A, B]);
  });

  it("does not leak the project to code that runs after the approval finished", async () => {
    await runWithConsentProject({ userId: "u1", projectId: A }, async () => undefined);
    await expect(resolveConsentProject({ userId: "u1" })).resolves.toBeUndefined();
  });
});

describe("when the module is loaded more than once (as a Next.js build can)", () => {
  it("shares the approval's project between the copy that sets it and the copy that reads it", async () => {
    let setter: typeof import("./connect-project");
    let reader: typeof import("./connect-project");
    jest.isolateModules(() => {
      setter = require("./connect-project");
    });
    jest.isolateModules(() => {
      reader = require("./connect-project");
    });
    // Two genuinely separate module instances.
    expect(setter!).not.toBe(reader!);
    const seen = await setter!.runWithConsentProject({ userId: "u1", projectId: A }, () =>
      reader!.resolveConsentProject({ userId: "u1" }),
    );
    expect(seen).toBe(A);
  });
});

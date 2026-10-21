/** @jest-environment node */
const mockSelect = jest.fn();
const mockDelete = jest.fn();
const mockInsert = jest.fn();
const mockGetSelectable = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: (...a: unknown[]) => mockSelect(...a) }) }) }),
    delete: () => ({ where: (...a: unknown[]) => mockDelete(...a) }),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        delete: () => ({ where: (...a: unknown[]) => mockDelete(...a) }),
        insert: () => ({ values: (...a: unknown[]) => mockInsert(...a) }),
      }),
  },
}));
jest.mock("@/lib/session", () => ({ getSelectableProjects: (...a: unknown[]) => mockGetSelectable(...a) }));

import {
  McpProjectAccessError,
  clearProjectSelection,
  readProjectSelection,
  saveProjectSelection,
} from "./project-selection";

const PROJECT = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const row = (value: unknown, expiresInMs = 60_000) => [
  { value: typeof value === "string" ? value : JSON.stringify(value), expiresAt: new Date(Date.now() + expiresInMs) },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSelectable.mockResolvedValue([{ id: PROJECT, name: "P" }]);
  mockDelete.mockResolvedValue(undefined);
  mockInsert.mockResolvedValue(undefined);
});

describe("saveProjectSelection", () => {
  it("stores the choice for the session when the user can view the project", async () => {
    await saveProjectSelection({ sessionId: "s1", userId: "u1", projectId: PROJECT });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "mcp-project:s1",
        value: JSON.stringify({ userId: "u1", projectId: PROJECT }),
      }),
    );
    const { expiresAt } = mockInsert.mock.calls[0][0] as { expiresAt: Date };
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
  });

  it("replaces an earlier choice for the same session", async () => {
    await saveProjectSelection({ sessionId: "s1", userId: "u1", projectId: PROJECT });
    expect(mockDelete.mock.invocationCallOrder[0]).toBeLessThan(mockInsert.mock.invocationCallOrder[0]);
  });

  it("refuses a project the user cannot connect, and stores nothing", async () => {
    await expect(
      saveProjectSelection({ sessionId: "s1", userId: "u1", projectId: "0197a1b2-c3d4-7e5f-8a9b-ffffffffffff" }),
    ).rejects.toBeInstanceOf(McpProjectAccessError);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("readProjectSelection", () => {
  it("returns the chosen project", async () => {
    mockSelect.mockResolvedValue(row({ userId: "u1", projectId: PROJECT }));
    await expect(readProjectSelection({ sessionId: "s1", userId: "u1" })).resolves.toBe(PROJECT);
  });

  it.each([
    ["no choice was made", []],
    ["the choice expired", row({ userId: "u1", projectId: PROJECT }, -1)],
    ["it was made for a different user", row({ userId: "someone-else", projectId: PROJECT })],
    ["the stored value is not JSON", row("not json")],
    ["the stored value has no project", row({ userId: "u1" })],
    ["the stored project is not a string", row({ userId: "u1", projectId: 42 })],
  ])("returns nothing when %s", async (_name, rows) => {
    mockSelect.mockResolvedValue(rows);
    await expect(readProjectSelection({ sessionId: "s1", userId: "u1" })).resolves.toBeUndefined();
  });

  it("re-checks access, so a user who lost the project cannot be granted it", async () => {
    mockSelect.mockResolvedValue(row({ userId: "u1", projectId: PROJECT }));
    mockGetSelectable.mockResolvedValue([]);
    await expect(readProjectSelection({ sessionId: "s1", userId: "u1" })).resolves.toBeUndefined();
  });
});

describe("clearProjectSelection", () => {
  it("deletes the session's choice", async () => {
    await clearProjectSelection("s1");
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

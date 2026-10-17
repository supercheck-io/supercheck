/** @jest-environment node */
import { NextRequest } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { saveTest } from "./save-test";
import { PUT } from "@/app/api/tests/[id]/route";
import { encodeStoredTestScript } from "@/lib/test-script";

const mockSet = jest.fn();
let stored = {
  id: "test-id",
  script: "",
  type: "browser",
  title: "Before",
  priority: "medium",
};
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [stored] }) }),
    }),
    query: { tests: { findFirst: async () => stored } },
    update: () => ({
      set: (data: unknown) => {
        mockSet(data);
        return { where: () => ({ returning: async () => [stored] }) };
      },
    }),
  },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: async () => ({
    userId: "user",
    organizationId: "org",
    project: { id: "project", name: "Project" },
  }),
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({
    userId: "user",
    organizationId: "org",
    project: { id: "project" },
  }),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(() => true),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/requirements-internal", () => ({
  updateCoverageSnapshot: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

beforeEach(() => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  mockSet.mockClear();
  stored = {
    id: "test-id",
    script: "",
    type: "browser",
    title: "Before",
    priority: "medium",
  };
});

async function update(
  flow: string,
  fields: { script?: string; type?: "browser" | "performance" },
) {
  if (flow === "action")
    return (await saveTest({ id: "test-id", title: "Renamed", ...fields }))
      .success;
  return (
    (
      await PUT(
        new NextRequest("http://localhost/api/tests/test-id", {
          method: "PUT",
          body: JSON.stringify({ title: "Renamed", ...fields }),
        }),
        { params: Promise.resolve({ id: "test-id" }) },
      )
    ).status === 200
  );
}

it.each(["action", "api"])(
  "preserves legacy script and type on metadata-only %s updates",
  async (flow) => {
    stored.script = encodeStoredTestScript(
      "import http from 'k6/http'; const broken = ;",
    );
    stored.type = "performance";
    expect(await update(flow, {})).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ script: stored.script, type: "performance" }),
    );
  },
);

it.each(["action", "api"])(
  "still validates explicitly submitted source in %s",
  async (flow) => {
    expect(await update(flow, { script: "const broken = ;" })).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  },
);

it.each(["action", "api"])(
  "still validates type-only changes in %s",
  async (flow) => {
    stored.script = encodeStoredTestScript("console.log('browser');");
    expect(await update(flow, { type: "performance" })).toBe(false);
  },
);

it.each(["action", "api"])(
  "allows legacy size and complexity limits to remain untouched in %s",
  async (flow) => {
    for (const script of ["a++;".repeat(1001), "//" + "a".repeat(1_000_001)]) {
      stored.script = encodeStoredTestScript(script);
      expect(await update(flow, {})).toBe(true);
      expect(mockSet).toHaveBeenLastCalledWith(
        expect.objectContaining({ script: stored.script }),
      );
    }
  },
);

it.each([
  [{ id: "test-id", title: "T" }, "Insufficient permissions to edit tests"],
  [{ title: "T" }, "Insufficient permissions to create tests"],
])("denies %p before lookup or validation", async (input, error) => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(false);
  const result = await saveTest({ ...input, script: "const a = ;" });
  expect(result).toEqual({ id: "", success: false, error });
  expect(mockSet).not.toHaveBeenCalled();
});

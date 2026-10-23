/** @jest-environment node */
import { NextRequest } from "next/server";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { saveTest } from "./save-test";
import { PUT } from "@/app/api/tests/[id]/route";
import { encodeStoredTestScript } from "@/lib/test-script";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";

jest.mock("@/lib/services/subscription-service", () => ({
  SubscriptionAccessDeniedError: class extends Error {},
  subscriptionService: {
    blockUntilSubscribed: jest.fn(async () => {}),
    requireValidPolarCustomer: jest.fn(async () => {}),
  },
}));

const mockSet = jest.fn();
let stored = {
  id: "00000000-0000-4000-8000-000000000001",
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
  jest.mocked(subscriptionService.blockUntilSubscribed).mockReset().mockResolvedValue();
  jest.mocked(subscriptionService.requireValidPolarCustomer).mockReset().mockResolvedValue();
  jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  mockSet.mockClear();
  stored = {
    id: "00000000-0000-4000-8000-000000000001",
    script: "",
    type: "browser",
    title: "Before",
    priority: "medium",
  };
});

it.each(["blockUntilSubscribed", "requireValidPolarCustomer"] as const)(
  "rejects direct save action before writing when %s denies access",
  async (guard) => {
    jest.mocked(subscriptionService[guard]).mockRejectedValue(new SubscriptionAccessDeniedError("Subscription required", "subscription_required"));
    const result = await saveTest({ id: "00000000-0000-4000-8000-000000000001", title: "Renamed" });
    expect(result).toEqual({ id: "", success: false, error: "Subscription required" });
    expect(mockSet).not.toHaveBeenCalled();
  },
);

it("checks the authenticated organization before a permitted save", async () => {
  expect(await update("action", {})).toBe(true);
  expect(subscriptionService.blockUntilSubscribed).toHaveBeenCalledWith("org");
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith("org");
});

async function update(
  flow: string,
  fields: { script?: string; type?: "browser" | "performance" },
) {
  if (flow === "action")
    return (await saveTest({ id: "00000000-0000-4000-8000-000000000001", title: "Renamed", ...fields }))
      .success;
  return (
    (
      await PUT(
        new NextRequest("http://localhost/api/tests/00000000-0000-4000-8000-000000000001", {
          method: "PUT",
          body: JSON.stringify({ title: "Renamed", ...fields }),
        }),
        { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
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
  [{ id: "00000000-0000-4000-8000-000000000001", title: "T" }, "Insufficient permissions to edit tests"],
  [{ title: "T" }, "Insufficient permissions to create tests"],
])("denies %p before lookup or validation", async (input, error) => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(false);
  const result = await saveTest({ ...input, script: "const a = ;" });
  expect(result).toEqual({ id: "", success: false, error });
  expect(mockSet).not.toHaveBeenCalled();
});

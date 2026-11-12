/** @jest-environment node */
const findMany = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { query: { statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) }, statusPageComponents: { findMany: (...args: unknown[]) => findMany(...args) } } },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ organizationId: "org", project: { id: "proj" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requirePermissions: jest.fn(async () => ({ userId: "u" })),
  hasPermissionForUser: jest.fn(async () => true),
}));
import { getComponents } from "./get-components";

const monitor = (id: string, deletingAt: Date | null) => ({ weight: 1, monitor: { id, name: id, type: "http_request", status: "up", target: "https://example.com", deletingAt } });

it("does not list a monitor that is being deleted on a component", async () => {
  findMany.mockResolvedValueOnce([{ id: "c1", name: "API", monitors: [monitor("live", null), monitor("gone", new Date())] }]);
  const result = await getComponents("00000000-0000-4000-8000-000000000001");
  expect(result.success).toBe(true);
  expect(result.components[0].monitorIds).toEqual(["live"]);
  expect(result.components[0].monitors.map((m: { id: string }) => m.id)).toEqual(["live"]);
});

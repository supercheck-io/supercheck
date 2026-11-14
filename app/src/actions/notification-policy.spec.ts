/** @jest-environment node */
const findFirst = jest.fn();
const select = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { projects: { findFirst: (...a: unknown[]) => findFirst(...a) } }, select: (...a: unknown[]) => select(...a) } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ organizationId: "org-1", userId: "user-1" })) }));
const hasPermission = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ hasPermission: (...a: unknown[]) => hasPermission(...a) }));
const saveNotificationPolicy = jest.fn();
jest.mock("@/lib/sre/notification-policy", () => ({
  ...jest.requireActual("@/lib/sre/notification-policy"),
  getNotificationPolicy: jest.fn(async () => ({ channelIds: [] })),
  saveNotificationPolicy: (...a: unknown[]) => saveNotificationPolicy(...a),
}));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ listAssignableUsers: jest.fn(async () => [{ id: "u1", name: "Ada", image: null }]) }));
jest.mock("@/lib/notification-providers/crypto", () => ({ decryptNotificationProviderConfig: (config: unknown) => config }));
const assertOrgWritable = jest.fn();
jest.mock("@/lib/deletion/org-state", () => ({
  ...jest.requireActual("@/lib/deletion/__mocks__/org-state"),
  assertOrgWritable: (...a: unknown[]) => assertOrgWritable(...a),
}));

import { OrgPendingDeletionError } from "@/lib/deletion/__mocks__/org-state";
import { getProjectNotificationPolicy, saveProjectNotificationPolicy } from "./notification-policy";

const project = "018f0000-0000-7000-8000-00000000000b";
const channel = "018f0000-0000-7000-8000-0000000000c1";
const valid = { channelIds: [channel], emailServiceOwnersOnSev12: true, renotifyUnackedMinutes: 30, autoInvestigateOnOpen: false };

beforeEach(() => {
  jest.clearAllMocks();
  findFirst.mockResolvedValue({ id: project });
  hasPermission.mockResolvedValue(true);
  assertOrgWritable.mockResolvedValue(undefined);
  saveNotificationPolicy.mockResolvedValue({ success: true });
});

it("rejects a project outside the caller's organization, looking it up by project id AND organization", async () => {
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
  findFirst.mockResolvedValue(undefined);
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: false, error: "Access denied" });
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
  expect(hasPermission).not.toHaveBeenCalled();
  const query = new PgDialect().sqlToQuery(findFirst.mock.calls[0][0].where);
  expect(query.sql).toContain('"organization_id" = $');
  expect(query.params).toEqual(expect.arrayContaining([project, "org-1"]));
});

it("requires update permission on the target project (editor and viewer are denied)", async () => {
  hasPermission.mockResolvedValue(false);
  expect(await saveProjectNotificationPolicy(project, valid)).toMatchObject({ success: false, error: "Insufficient permissions" });
  expect(hasPermission).toHaveBeenCalledWith("project", "update", { organizationId: "org-1", projectId: project });
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
});

it("validates the input before any database access", async () => {
  expect(await saveProjectNotificationPolicy(project, { ...valid, renotifyUnackedMinutes: 2 })).toEqual({ success: false, error: "Invalid notification policy" });
  expect(await saveProjectNotificationPolicy(project, { ...valid, extra: 1 } as never)).toEqual({ success: false, error: "Invalid notification policy" });
  expect(findFirst).not.toHaveBeenCalled();
});

it("saves through the shared policy logic with the caller as the audit actor", async () => {
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: true });
  expect(saveNotificationPolicy).toHaveBeenCalledWith({ organizationId: "org-1", projectId: project, userId: "user-1" }, valid);
});

it("returns the shared logic's validation error", async () => {
  saveNotificationPolicy.mockResolvedValue({ success: false, error: "Choose who to escalate to" });
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: false, error: "Choose who to escalate to" });
});

it("refuses to save for an organization pending deletion", async () => {
  assertOrgWritable.mockRejectedValue(new OrgPendingDeletionError("This organization is scheduled for deletion and is read-only."));
  const result = await saveProjectNotificationPolicy(project, valid);
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("scheduled for deletion") });
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
});

it("loads the policy with this project's channels (paging presets marked) and members", async () => {
  const where = jest.fn(() => ({ limit: async () => [
    { id: "c1", name: "ops", type: "slack", config: { webhookUrl: "x" } },
    { id: "c2", name: "pd", type: "webhook", config: { url: "x", preset: "pagerduty" } },
  ] }));
  select.mockReturnValue({ from: () => ({ where }) });
  const result = await getProjectNotificationPolicy(project);
  expect(result.data?.channels).toEqual([
    { id: "c1", name: "ops", type: "slack", paging: false },
    { id: "c2", name: "pd", type: "webhook", paging: true },
  ]);
  expect(result.data?.members).toEqual([{ id: "u1", name: "Ada" }]);
  expect(hasPermission).toHaveBeenCalledWith("project", "view", { organizationId: "org-1", projectId: project });
});

it("rejects a malformed project id before any database access", async () => {
  expect(await getProjectNotificationPolicy("zzz")).toEqual({ success: false, error: "Access denied" });
  expect(await saveProjectNotificationPolicy("zzz", valid)).toEqual({ success: false, error: "Access denied" });
  expect(findFirst).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

/** @jest-environment node */
const findFirst = jest.fn();
const select = jest.fn();
const insert = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { projects: { findFirst: (...a: unknown[]) => findFirst(...a) } }, select: (...a: unknown[]) => select(...a), insert: (...a: unknown[]) => insert(...a) } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ organizationId: "org-1" })) }));
const hasPermission = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ hasPermission: (...a: unknown[]) => hasPermission(...a) }));
jest.mock("@/lib/sre/notification-policy", () => ({ getNotificationPolicy: jest.fn() }));

import { saveProjectNotificationPolicy } from "./notification-policy";

const project = "018f0000-0000-7000-8000-00000000000b";
const channel = "018f0000-0000-7000-8000-0000000000c1";
const valid = { channelIds: [channel], emailServiceOwnersOnSev12: true, renotifyUnackedMinutes: 30, autoInvestigateOnOpen: false };
const rows = (r: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(r) }) });

beforeEach(() => {
  jest.clearAllMocks();
  findFirst.mockResolvedValue({ id: project });
  hasPermission.mockResolvedValue(true);
});

it("rejects a project outside the caller's organization", async () => {
  findFirst.mockResolvedValue(undefined);
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: false, error: "Access denied" });
  expect(insert).not.toHaveBeenCalled();
});

it("requires update permission on the target project", async () => {
  hasPermission.mockResolvedValue(false);
  expect(await saveProjectNotificationPolicy(project, valid)).toMatchObject({ success: false, error: "Insufficient permissions" });
  expect(hasPermission).toHaveBeenCalledWith("project", "update", { organizationId: "org-1", projectId: project });
});

it("rejects channels that are not this project's and out-of-range re-notify times", async () => {
  select.mockReturnValue(rows([]));
  expect(await saveProjectNotificationPolicy(project, valid)).toMatchObject({ success: false, error: "Some channels do not belong to this project" });
  expect(await saveProjectNotificationPolicy(project, { ...valid, renotifyUnackedMinutes: 2 })).toMatchObject({ success: false, error: "Invalid notification policy" });
});

it("upserts the project's single policy", async () => {
  select.mockReturnValue(rows([{ id: channel }]));
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn(() => ({ onConflictDoUpdate }));
  insert.mockReturnValue({ values });
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: true });
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", projectId: project, channelIds: [channel], renotifyUnackedMinutes: 30 }));
  expect(onConflictDoUpdate).toHaveBeenCalled();
});

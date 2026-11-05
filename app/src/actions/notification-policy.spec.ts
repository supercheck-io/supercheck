/** @jest-environment node */
const findFirst = jest.fn();
const select = jest.fn();
const insert = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { projects: { findFirst: (...a: unknown[]) => findFirst(...a) } }, select: (...a: unknown[]) => select(...a), insert: (...a: unknown[]) => insert(...a) } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ organizationId: "org-1" })) }));
const hasPermission = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ hasPermission: (...a: unknown[]) => hasPermission(...a) }));
jest.mock("@/lib/sre/notification-policy", () => ({ getNotificationPolicy: jest.fn() }));

import { getProjectNotificationPolicy, saveProjectNotificationPolicy } from "./notification-policy";

const project = "018f0000-0000-7000-8000-00000000000b";
const channel = "018f0000-0000-7000-8000-0000000000c1";
const valid = { channelIds: [channel], emailServiceOwnersOnSev12: true, renotifyUnackedMinutes: 30, autoInvestigateOnOpen: false };
const rows = (r: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(r) }) });

beforeEach(() => {
  jest.clearAllMocks();
  findFirst.mockResolvedValue({ id: project });
  hasPermission.mockResolvedValue(true);
});

it("rejects a project outside the caller's organization, looking it up by project id AND organization", async () => {
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
  findFirst.mockResolvedValue(undefined);
  expect(await saveProjectNotificationPolicy(project, valid)).toEqual({ success: false, error: "Access denied" });
  expect(insert).not.toHaveBeenCalled();
  expect(hasPermission).not.toHaveBeenCalled();
  const query = new PgDialect().sqlToQuery(findFirst.mock.calls[0][0].where);
  expect(query.sql).toContain('"organization_id" = $');
  expect(query.params).toEqual(expect.arrayContaining([project, "org-1"]));
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

it("stamps the auto-investigate time only while it is on", async () => {
  select.mockReturnValue(rows([]));
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn((_row: Record<string, unknown>) => ({ onConflictDoUpdate }));
  insert.mockReturnValue({ values });
  await saveProjectNotificationPolicy(project, { ...valid, channelIds: [], autoInvestigateOnOpen: true });
  expect(values.mock.calls[0][0].autoInvestigateEnabledAt).toBeInstanceOf(Date);
  // On conflict the stored time is kept (coalesce), so an unrelated save does not move it.
  expect(onConflictDoUpdate.mock.calls[0][0].set.autoInvestigateEnabledAt).toBeDefined();
  expect(onConflictDoUpdate.mock.calls[0][0].set.autoInvestigateEnabledAt).not.toBeNull();
  await saveProjectNotificationPolicy(project, { ...valid, channelIds: [], autoInvestigateOnOpen: false });
  expect(values.mock.calls[1][0].autoInvestigateEnabledAt).toBeNull();
  expect(onConflictDoUpdate.mock.calls[1][0].set.autoInvestigateEnabledAt).toBeNull();
});

it("rejects a malformed project id before any database access", async () => {
  expect(await getProjectNotificationPolicy("zzz")).toEqual({ success: false, error: "Access denied" });
  expect(await saveProjectNotificationPolicy("zzz", valid)).toEqual({ success: false, error: "Access denied" });
  expect(findFirst).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

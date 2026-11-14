/** @jest-environment node */
import { NextRequest } from "next/server";

class MockAuthError extends Error { constructor(message: string, public status: 401 | 403 = 401) { super(message); } }
let mockAuth: () => Promise<unknown>;
const context = (role: string, extra: Record<string, unknown> = {}) => async () => ({
  userId: "user-1", organizationId: "org-1", orgPendingDeletion: false, isCliAuth: true, project: { id: "proj-1", userRole: role }, ...extra,
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockAuth(),
  isAuthError: (e: unknown) => e instanceof MockAuthError,
  authErrorStatus: (e: MockAuthError) => e.status,
}));
const getNotificationPolicy = jest.fn();
const saveNotificationPolicy = jest.fn();
jest.mock("@/lib/sre/notification-policy", () => ({
  getNotificationPolicy: (...a: unknown[]) => getNotificationPolicy(...a),
  saveNotificationPolicy: (...a: unknown[]) => saveNotificationPolicy(...a),
}));
jest.mock("@/lib/deletion/org-state");

import { GET, PUT } from "./route";

const stored = { channelIds: [], emailServiceOwnersOnSev12: false, renotifyUnackedMinutes: 15, renotifyRepeatMinutes: 60, renotifyMax: 3, escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null, autoInvestigateOnOpen: false, autoInvestigateEnabledAt: null };
const put = (body: string) => PUT(new NextRequest("https://example.com/api/notification-policy", { method: "PUT", body }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = context("project_admin");
  getNotificationPolicy.mockResolvedValue(stored);
  saveNotificationPolicy.mockResolvedValue({ success: true });
});

it("returns the current project's policy to any project role", async () => {
  mockAuth = context("project_viewer");
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ policy: stored });
  expect(getNotificationPolicy).toHaveBeenCalledWith("proj-1");
});

it("saves for a project admin, scoped to the token's project, then returns the stored policy", async () => {
  const res = await put(JSON.stringify({ renotifyUnackedMinutes: 15 }));
  expect(res.status).toBe(200);
  expect(saveNotificationPolicy).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "proj-1", userId: "user-1" }, { renotifyUnackedMinutes: 15 });
  expect((await res.json()).policy).toEqual(stored);
});

it("accepts the policy exactly as GET returned it (the server-owned stamp is ignored)", async () => {
  const res = await put(JSON.stringify({ renotifyUnackedMinutes: 15, autoInvestigateEnabledAt: "2026-11-14T00:00:00Z" }));
  expect(res.status).toBe(200);
  expect(saveNotificationPolicy).toHaveBeenCalledWith(expect.anything(), { renotifyUnackedMinutes: 15 });
});

it("returns the validation error as 400", async () => {
  saveNotificationPolicy.mockResolvedValue({ success: false, error: "Reminders must finish within 2 days" });
  const res = await put("{}");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Reminders must finish within 2 days" });
});

it.each(["project_editor", "project_viewer"])("denies %s", async (role) => {
  mockAuth = context(role);
  expect((await put("{}")).status).toBe(403);
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
});

it("denies writes in an organization pending deletion", async () => {
  mockAuth = context("org_owner", { orgPendingDeletion: true });
  expect((await put("{}")).status).toBe(403);
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
});

it("returns 401 unauthenticated and 403 for a CLI key that cannot reach the project", async () => {
  mockAuth = async () => { throw new MockAuthError("Authentication required"); };
  expect((await GET()).status).toBe(401);
  mockAuth = async () => { throw new MockAuthError("CLI token has no project scope", 403); };
  expect((await put("{}")).status).toBe(403);
});

it("rejects invalid JSON and oversized bodies", async () => {
  expect((await put("{")).status).toBe(400);
  expect((await put(JSON.stringify({ pad: "x".repeat(9000) }))).status).toBe(413);
  expect(saveNotificationPolicy).not.toHaveBeenCalled();
});

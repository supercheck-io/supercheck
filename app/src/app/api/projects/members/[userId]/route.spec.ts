/** @jest-environment node */
const mockSelect = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => mockSelect(...a) } }));
const mockAuth = jest.fn();
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: () => mockAuth(),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
const mockCan = jest.fn();
const mockRole = jest.fn();
const mockOrgRole = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: (...a: unknown[]) => mockCan(...a),
  getUserRole: (...a: unknown[]) => mockRole(...a),
  getUserOrgRole: (...a: unknown[]) => mockOrgRole(...a),
}));
jest.mock("@/lib/deletion/org-state");
import { NextRequest } from "next/server";
import { isOrgPendingDeletion } from "@/lib/deletion/org-state";
import { GET } from "./route";

const ID = "0c11ab1e-7460-5139-b3b8-920f69f95082";
const get = () => GET(new NextRequest(`http://localhost/api/projects/members/${ID}`), { params: Promise.resolve({ userId: ID }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "u", organizationId: "org", projectId: null, isCliAuth: false });
  mockSelect.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: async () => [{ projectId: "p", role: "project_editor", projectName: "P", projectDescription: null }] }) }) });
});

it("returns assignments to a manager", async () => {
  mockCan.mockResolvedValue(true);
  expect((await get()).status).toBe(200);
});

it("keeps the read available to an owner while the organization is pending deletion", async () => {
  mockCan.mockResolvedValue(false); // the pending block denies member:update
  (isOrgPendingDeletion as jest.Mock).mockResolvedValue(true);
  mockRole.mockResolvedValue("org_owner");
  mockOrgRole.mockResolvedValue("org_owner");
  expect((await get()).status).toBe(200);
});

it("still refuses a role without member:update while pending", async () => {
  mockCan.mockResolvedValue(false);
  (isOrgPendingDeletion as jest.Mock).mockResolvedValue(true);
  mockRole.mockResolvedValue("project_viewer");
  mockOrgRole.mockResolvedValue("project_viewer");
  expect((await get()).status).toBe(403);
});

it("refuses when the caller lacks permission and the organization is not pending", async () => {
  mockCan.mockResolvedValue(false);
  (isOrgPendingDeletion as jest.Mock).mockResolvedValue(false);
  expect((await get()).status).toBe(403);
});

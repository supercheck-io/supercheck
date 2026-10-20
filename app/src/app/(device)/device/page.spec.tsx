import { render, screen } from "@testing-library/react";

const mockRedirect = jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
const mockGetSession = jest.fn();
const mockAllow = jest.fn();
const mockLookup = jest.fn();
const mockProjects = jest.fn();
const mockMemberships = jest.fn();
let enabled = true;

jest.mock("next/navigation", () => ({ redirect: (u: string) => mockRedirect(u), useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } } }));
jest.mock("@/utils/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mockMemberships() }) }) },
}));
jest.mock("@/db/schema", () => ({ member: { organizationId: "o", userId: "u" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn() }));
jest.mock("@/lib/session", () => ({ getUserProjects: (...a: unknown[]) => mockProjects(...a) }));
jest.mock("@/lib/rbac/client-permissions", () => ({ canManageAPIKeys: (r: string) => r !== "project_viewer" }));
jest.mock("@/lib/auth/device-auth-rate-limit", () => ({
  allowDeviceAuthRequest: (...a: unknown[]) => mockAllow(...a),
  DEVICE_AUTH_LIMITS: { verifyPerUser: () => ({}) },
}));
jest.mock("@/lib/auth/device-authorization", () => ({
  isDeviceAuthEnabled: () => enabled,
  lookupPendingGrant: (...a: unknown[]) => mockLookup(...a),
  normalizeUserCode: (c: string) => { const x = c.toUpperCase().replace(/[\s-]/g, ""); return /^[BCDFGHJKMNPQRTVWXYZ2346789]{8}$/.test(x) ? x : null; },
  formatUserCode: (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`,
}));

import DevicePage from "./page";

const render_ = async (code?: string | string[]) => render(await DevicePage({ searchParams: Promise.resolve({ code }) }));
const session = { user: { id: "u1", email: "me@example.com" } };
const grant = { clientName: "supercheck-cli", cliVersion: "0.4.0", hostname: "laptop", requestIp: "203.0.113.9", expiresAt: new Date() };
const project = (role: string, isDefault = false) => ({ id: "p", name: "P", organizationName: "Org", isDefault, role });

beforeEach(() => {
  jest.clearAllMocks();
  enabled = true;
  mockGetSession.mockResolvedValue(session);
  mockAllow.mockResolvedValue(true);
  mockLookup.mockResolvedValue(grant);
  mockMemberships.mockResolvedValue([{ organizationId: "o1" }]);
  mockProjects.mockResolvedValue([project("project_admin", true)]);
});

describe("/device page", () => {
  it("explains how to proceed when device login is disabled and never touches auth", async () => {
    enabled = false;
    await render_("BCDF-GHJK");
    expect(screen.getByText(/browser login is not enabled/i)).toBeInTheDocument();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors to sign-in with an allowlisted continuation", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(render_("bcdf ghjk")).rejects.toThrow("REDIRECT:/sign-in?next=%2Fdevice%3Fcode%3DBCDF-GHJK");
    mockRedirect.mockClear();
    await expect(render_("<script>alert(1)</script>")).rejects.toThrow("REDIRECT:/sign-in?next=%2Fdevice");
  });

  it("shows the code entry form (GET only) when no code is present", async () => {
    await render_();
    const form = screen.getByRole("textbox", { name: /device code/i }).closest("form")!;
    expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects malformed codes without querying the database", async () => {
    await render_("nope");
    expect(screen.getByRole("alert")).toHaveTextContent(/not valid/i);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rate limits authenticated lookups", async () => {
    mockAllow.mockResolvedValue(false);
    await render_("BCDF-GHJK");
    expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("reports unknown, expired or used codes with a single message", async () => {
    mockLookup.mockResolvedValue(null);
    await render_("BCDF-GHJK");
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid, expired or already used/i);
  });

  it("offers workspace creation to users with no organization", async () => {
    mockMemberships.mockResolvedValue([]);
    mockProjects.mockResolvedValue([]);
    await render_("BCDF-GHJK");
    expect(screen.getByRole("button", { name: /create my workspace/i })).toBeInTheDocument();
  });

  it("explains missing permission when the user only has viewer access", async () => {
    mockProjects.mockResolvedValue([project("project_viewer")]);
    await render_("BCDF-GHJK");
    expect(screen.getByText(/no project available/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows only projects the user can create keys for, and the approval UI", async () => {
    mockProjects.mockResolvedValue([project("project_viewer"), { ...project("org_owner", true), name: "Mine" }]);
    await render_("BCDF-GHJK");
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("P")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
  });
});

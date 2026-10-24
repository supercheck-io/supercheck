import { render, screen, fireEvent } from "@testing-library/react";

const mockRedirect = jest.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
const mockGetSession = jest.fn();
const mockAllow = jest.fn();
const mockLookup = jest.fn();
const mockProjects = jest.fn();
const mockMemberships = jest.fn();
const mockOrgs = jest.fn();
const mockAccess = jest.fn();
let enabled = true;

jest.mock("next/navigation", () => ({ redirect: (u: string) => mockRedirect(u), useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } } }));
jest.mock("@/utils/db", () => ({
  db: { select: (cols: Record<string, unknown>) => ({ from: () => ({ where: () => ("name" in cols ? mockOrgs() : mockMemberships()) }) }) },
}));
jest.mock("@/db/schema", () => ({ member: { organizationId: "o", userId: "u" }, organization: { id: "id", name: "name" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), inArray: jest.fn() }));
jest.mock("@/lib/session", () => ({ getUserProjects: (...a: unknown[]) => mockProjects(...a) }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: { getSubscriptionAccessStatus: (...a: unknown[]) => mockAccess(...a) } }));
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
const project = (role: string, isDefault = false) => ({ id: "p", name: "P", organizationId: "o1", isDefault, role });

beforeEach(() => {
  jest.clearAllMocks();
  enabled = true;
  mockGetSession.mockResolvedValue(session);
  mockAllow.mockResolvedValue(true);
  mockLookup.mockResolvedValue(grant);
  mockMemberships.mockResolvedValue([{ organizationId: "o1", role: "org_owner" }]);
  mockAccess.mockResolvedValue({ isActive: true });
  mockOrgs.mockResolvedValue([{ id: "o1", name: "Acme Inc" }]);
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
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByText("P")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows the plan notice for an organization without an active plan, and lets only owners purchase", async () => {
    mockAccess.mockResolvedValue({ isActive: false });
    await render_("BCDF-GHJK");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About CLI access" }));
    expect(screen.getByRole("note")).toHaveTextContent(/Acme Inc has no active plan/i);
    expect(screen.getByRole("button", { name: "Choose a plan" })).toBeInTheDocument();
  });

  it("does not offer purchase to a member who is not the organization owner", async () => {
    mockAccess.mockResolvedValue({ isActive: false });
    mockMemberships.mockResolvedValue([{ organizationId: "o1", role: "org_admin" }]);
    await render_("BCDF-GHJK");
    fireEvent.click(screen.getByRole("button", { name: "About CLI access" }));
    expect(screen.getByRole("note")).toHaveTextContent(/only an organization owner/i);
    expect(screen.queryByRole("button", { name: "Choose a plan" })).not.toBeInTheDocument();
  });

  it("looks plans up only for organizations with an eligible project, and tolerates mixed failures", async () => {
    mockMemberships.mockResolvedValue([
      { organizationId: "o1", role: "org_owner" },
      { organizationId: "o2", role: "org_owner" },
      { organizationId: "o3", role: "project_viewer" },
    ]);
    mockOrgs.mockResolvedValue([{ id: "o1", name: "One" }, { id: "o2", name: "Two" }, { id: "o3", name: "Three" }]);
    mockProjects.mockImplementation(async (_user: string, org: string) => [
      { id: `p-${org}`, name: `P-${org}`, organizationId: org, isDefault: true, role: org === "o3" ? "project_viewer" : "org_owner" },
    ]);
    mockAccess.mockImplementation(async (org: string) => {
      if (org === "o1") throw new Error("polar down");
      return { isActive: false };
    });
    await render_("BCDF-GHJK");
    const asked = mockAccess.mock.calls.map((c) => c[0]).sort();
    expect(asked).toEqual(["o1", "o2"]); // o3 has no project the user may issue keys for
    expect(screen.queryByText("P-o3")).not.toBeInTheDocument();
    // default project is the first eligible one (o1, lookup failed -> no notice); the failed lookup never blocks the page
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows no notice when the plan is active or the lookup fails", async () => {
    await render_("BCDF-GHJK");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    mockAccess.mockRejectedValue(new Error("polar down"));
    document.body.innerHTML = "";
    await render_("BCDF-GHJK");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});

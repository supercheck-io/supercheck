/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("drizzle-orm", () => ({
  ...jest.requireActual("drizzle-orm"),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => ({ conditions: conditions.filter(Boolean) }),
}));

import { db } from "@/utils/db";
import { projects } from "@/db/schema";
import { getUnifiedAuthContext } from "./unified-auth";

describe("organization and project consistency in unified auth", () => {
  const where = jest.fn();
  function rows(data: unknown[], track = false) {
    return { from: jest.fn().mockReturnThis(), leftJoin: jest.fn().mockReturnThis(), innerJoin: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      where: track ? where : jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(data) };
  }
  beforeEach(() => {
    jest.clearAllMocks();
    where.mockReturnThis();
    (db.select as jest.Mock).mockReturnValueOnce(rows([{ userId: "user", role: "project_viewer", activeOrgId: "org-b", activeProjectId: "project-a" }]))
      .mockReturnValueOnce(rows([], true));
  });

  it("filters stale implicit project selection to its selected host organization", async () => {
    const context = await getUnifiedAuthContext("token");
    expect(where).toHaveBeenCalledWith({ conditions: [
      { column: projects.id, value: "project-a" },
      { column: projects.status, value: "active" },
      { column: projects.organizationId, value: "org-b" },
    ] });
    expect(context).toMatchObject({ isValid: true, organizationId: null, projectId: null });
  });

  it("keeps invited-project authorization and billing separate from the user's owned organization", async () => {
    (db.select as jest.Mock).mockReset()
      .mockReturnValueOnce(rows([{ userId: "user", activeOrgId: "host-org", activeProjectId: "invited-project" }]))
      .mockReturnValueOnce(rows([{ projectId: "invited-project", projectOrgId: "host-org", orgRole: "project_editor", projectRole: "project_editor", polarId: "host-customer", subStatus: "active" }], true));
    expect(await getUnifiedAuthContext("token")).toMatchObject({ isValid: true, projectId: "invited-project", organizationId: "host-org", organizationRole: "project_editor", polarCustomerId: "host-customer" });
    expect(db.select).toHaveBeenCalledTimes(2);
  });
  it("does not select a legacy second owned organization's project implicitly", async () => {
    (db.select as jest.Mock).mockReset()
      .mockReturnValueOnce(rows([{ userId: "user", activeOrgId: "newer-org", activeProjectId: "newer-project" }]))
      .mockReturnValueOnce(rows([{ projectId: "newer-project", projectOrgId: "newer-org", orgRole: "org_owner" }], true))
      .mockReturnValueOnce(rows([{ id: "oldest-org" }]));
    expect(await getUnifiedAuthContext("token")).toMatchObject({ isValid: true, projectId: null, organizationId: null });
  });
  it("preserves explicit project overrides for membership-checked access", async () => {
    (db.select as jest.Mock).mockReset().mockReturnValueOnce(rows([{ userId: "user", activeOrgId: "org-b" }]))
      .mockReturnValueOnce(rows([{ projectId: "project-a", projectOrgId: "org-a", orgRole: "org_owner" }], true));
    expect(await getUnifiedAuthContext("token", "project-a")).toMatchObject({ isValid: true, organizationId: "org-a", projectId: "project-a" });
    expect(where).toHaveBeenCalledWith({ conditions: [
      { column: projects.id, value: "project-a" }, { column: projects.status, value: "active" },
    ] });
  });

  it("rejects a foreign project override without organization membership", async () => {
    (db.select as jest.Mock).mockReset().mockReturnValueOnce(rows([{ userId: "user", activeOrgId: "org-b" }]))
      .mockReturnValueOnce(rows([{ projectId: "foreign-project", projectOrgId: "foreign-org", orgRole: null }], true));
    expect(await getUnifiedAuthContext("token", "foreign-project")).toMatchObject({ isValid: false, projectId: null, organizationId: null });
  });
  it("fails closed for unsupported compound membership roles", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    (db.select as jest.Mock).mockReset().mockReturnValueOnce(rows([{ userId: "user", activeOrgId: "extra-org", activeProjectId: "extra-project" }]))
      .mockReturnValueOnce(rows([{ projectId: "extra-project", projectOrgId: "extra-org", orgRole: "org_owner,project_editor" }], true));
    expect(await getUnifiedAuthContext("token")).toMatchObject({ isValid: false, projectId: null, organizationId: null });
    jest.restoreAllMocks();
  });

});

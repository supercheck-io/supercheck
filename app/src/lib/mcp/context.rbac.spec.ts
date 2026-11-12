/** @jest-environment node */
// The other context specs replace the RBAC check. This one runs the real permission tables, so it fails if
// a resource name used by an MCP tool is not one the RBAC layer knows (for example "runs" instead of "run").
jest.mock("@/utils/db", () => ({ db: {} }));

import { assertCan, assertCanView, McpAccessDeniedError, type McpCallContext } from "./context";

const as = (role: string): McpCallContext => ({ userId: "u", clientId: "c", organizationId: "o", projectId: "p", role, orgPendingDeletion: false, scopes: ["mcp:read", "mcp:incidents:write", "mcp:sre"] });
const roles = ["super_admin", "org_owner", "org_admin", "project_admin", "project_editor", "project_viewer"];
const resources = [
  "test", "job", "run", "monitor", "requirement", "status_page", "variable",
  "sre_service", "sre_incident", "sre_investigation", "project",
] as const;

describe("assertCanView against the real RBAC tables", () => {
  it.each(roles.flatMap((role) => resources.map((resource) => [role, resource] as const)))(
    "%s may view %s",
    (role, resource) => {
      expect(() => assertCanView(as(role), resource)).not.toThrow();
    },
  );

  it("treats runs as their own resource, not as jobs", () => {
    // `run` is the RBAC resource for runs; the MCP run tools must authorise against it.
    expect(() => assertCanView(as("project_viewer"), "run")).not.toThrow();
  });

  it("denies a resource the RBAC layer does not know", () => {
    expect(() => assertCanView(as("project_admin"), "runs" as never)).toThrow(McpAccessDeniedError);
  });
});

describe("assertCan against the real RBAC tables", () => {
  it.each([
    ["project_viewer", "update", false],
    ["project_editor", "update", true],
    ["project_viewer", "investigate", false],
    ["project_editor", "investigate", true],
  ] as const)("%s %s sre_incident -> %s", (role, action, allowed) => {
    const scope = action === "update" ? "mcp:incidents:write" : "mcp:sre";
    const call = () => assertCan(as(role), "sre_incident", action, scope);
    if (allowed) expect(call).not.toThrow(); else expect(call).toThrow(McpAccessDeniedError);
  });
  it("denies every write of a pending organization with its own reason, and keeps reads", () => {
    const pending = { ...as("project_admin"), orgPendingDeletion: true };
    expect(() => assertCan(pending, "sre_incident", "update", "mcp:incidents:write")).toThrow(expect.objectContaining({ reason: "org_pending_deletion" }));
    expect(() => assertCanView(pending, "job")).not.toThrow();
  });
  it("knows the connector resource used for live investigations", () => {
    expect(() => assertCan(as("project_admin"), "sre_connector", "investigate", "mcp:sre")).not.toThrow();
  });
});

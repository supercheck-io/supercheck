/** @jest-environment node */
// The other context specs replace the RBAC check. This one runs the real permission tables, so it fails if
// a resource name used by an MCP tool is not one the RBAC layer knows (for example "runs" instead of "run").
jest.mock("@/utils/db", () => ({ db: {} }));

import { assertCanView, McpAccessDeniedError, type McpCallContext } from "./context";

const as = (role: string): McpCallContext => ({ userId: "u", clientId: "c", organizationId: "o", projectId: "p", role });
const roles = ["super_admin", "org_owner", "org_admin", "project_admin", "project_editor", "project_viewer"];
const resources = ["test", "job", "run", "monitor", "project"] as const;

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

import { formatAuditAction } from "./audit-action-labels";

describe("formatAuditAction", () => {
  it("humanises snake_case actions", () => {
    expect(formatAuditAction("cli_token_created")).toBe("CLI token created");
    expect(formatAuditAction("mcp_tool_call")).toBe("MCP tool call");
    expect(formatAuditAction("user_login")).toBe("User login");
  });

  it("handles dotted, dashed and mixed-case values", () => {
    expect(formatAuditAction("project.deleted")).toBe("Project deleted");
    expect(formatAuditAction("api-key-updated")).toBe("API key updated");
    expect(formatAuditAction("SSO_Config_Saved")).toBe("SSO config saved");
  });

  it("capitalises a leading acronym only via the acronym map", () => {
    expect(formatAuditAction("ip_blocked")).toBe("IP blocked");
  });

  it("returns the original value when nothing can be derived", () => {
    expect(formatAuditAction("___")).toBe("___");
    expect(formatAuditAction("")).toBe("");
  });
});

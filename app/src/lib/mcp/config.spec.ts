import {
  MCP_SCOPES,
  getMcpResourceUrl,
  isMcpDynamicRegistrationEnabled,
  isMcpServerEnabled,
} from "./config";

describe("MCP server flags", () => {
  it("is off unless explicitly enabled", () => {
    expect(isMcpServerEnabled({})).toBe(false);
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: "" })).toBe(false);
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: "1" })).toBe(false);
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: "false" })).toBe(false);
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: "true" })).toBe(true);
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: " TRUE " })).toBe(true);
  });

  it("accepts dynamic client registration unless an operator turns it off", () => {
    expect(isMcpDynamicRegistrationEnabled({})).toBe(true);
    expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: "true" })).toBe(true);
    expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: "false" })).toBe(false);
    expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: " False " })).toBe(false);
  });

  it("only ever offers the read scope and refresh", () => {
    expect([...MCP_SCOPES]).toEqual(["mcp:read", "offline_access"]);
  });
});

describe("getMcpResourceUrl", () => {
  it("is the /api/mcp URL of the app origin", () => {
    expect(getMcpResourceUrl({ APP_URL: "https://app.supercheck.io" })).toBe("https://app.supercheck.io/api/mcp");
  });

  it("ignores any path, query or fragment on the configured URL", () => {
    expect(getMcpResourceUrl({ APP_URL: "https://app.supercheck.io/some/path?x=1#frag" })).toBe(
      "https://app.supercheck.io/api/mcp",
    );
  });

  it("falls back through BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL", () => {
    expect(getMcpResourceUrl({ BETTER_AUTH_URL: "https://auth.example.com" })).toBe("https://auth.example.com/api/mcp");
    expect(getMcpResourceUrl({ NEXT_PUBLIC_APP_URL: "https://pub.example.com" })).toBe("https://pub.example.com/api/mcp");
  });

  it("allows plain HTTP only on loopback hosts", () => {
    expect(getMcpResourceUrl({ APP_URL: "http://localhost:3000" })).toBe("http://localhost:3000/api/mcp");
    expect(getMcpResourceUrl({ APP_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000/api/mcp");
    expect(() => getMcpResourceUrl({ APP_URL: "http://app.example.com" })).toThrow("HTTPS");
  });

  it("fails clearly when no app URL is configured", () => {
    expect(() => getMcpResourceUrl({})).toThrow("APP_URL");
  });
});

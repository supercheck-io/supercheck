import {
  MCP_SCOPES,
  getMcpResourceUrl,
  isMcpDynamicRegistrationEnabled,
  isMcpServerEnabled,
} from "./config";

describe("MCP server flags", () => {
  it.each(["true", "TRUE", " True ", "1", "yes", "on"])("enables the server for %p", (value) => {
    expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: value })).toBe(true);
  });

  it.each([undefined, "", "  ", "false", "0", "no", "off", "enabled", "tru"])(
    "keeps the server off for %p",
    (value) => {
      expect(isMcpServerEnabled({ MCP_SERVER_ENABLED: value })).toBe(false);
    },
  );

  it("accepts dynamic client registration when unset, and when explicitly on", () => {
    expect(isMcpDynamicRegistrationEnabled({})).toBe(true);
    expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: "" })).toBe(true);
    for (const value of ["true", "TRUE", "1", "yes", "on"]) {
      expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: value })).toBe(true);
    }
  });

  // Every way an operator might say "off" must turn it off; an unrecognisable value fails closed too.
  it.each(["false", " False ", "0", "no", "NO", "off", "Off", "disabled", "flase"])(
    "turns dynamic client registration off for %p",
    (value) => {
      expect(isMcpDynamicRegistrationEnabled({ MCP_DYNAMIC_CLIENT_REGISTRATION: value })).toBe(false);
    },
  );

  it("only ever offers the read scope and refresh", () => {
    expect([...MCP_SCOPES]).toEqual(["mcp:read", "offline_access"]);
  });
});

describe("getMcpResourceUrl", () => {
  it("is the /api/mcp URL of the Better Auth origin", () => {
    expect(getMcpResourceUrl({ BETTER_AUTH_URL: "https://app.supercheck.io" })).toBe("https://app.supercheck.io/api/mcp");
  });

  it("ignores any path, query or fragment on the configured URL", () => {
    expect(getMcpResourceUrl({ BETTER_AUTH_URL: "https://app.supercheck.io/some/path?x=1#frag" })).toBe(
      "https://app.supercheck.io/api/mcp",
    );
  });

  // Better Auth's issuer comes from BETTER_AUTH_URL alone; guessing from APP_URL could split issuer and audience.
  it.each([
    ["only APP_URL", { APP_URL: "https://app.example.com" }],
    ["only NEXT_PUBLIC_APP_URL", { NEXT_PUBLIC_APP_URL: "https://pub.example.com" }],
    ["a blank BETTER_AUTH_URL", { BETTER_AUTH_URL: "  ", APP_URL: "https://app.example.com" }],
    ["nothing", {}],
  ])("refuses to guess the resource when it has %s", (_name, env) => {
    expect(() => getMcpResourceUrl(env)).toThrow("BETTER_AUTH_URL");
  });

  it("allows plain HTTP only on loopback hosts", () => {
    expect(getMcpResourceUrl({ BETTER_AUTH_URL: "http://localhost:3000" })).toBe("http://localhost:3000/api/mcp");
    expect(getMcpResourceUrl({ BETTER_AUTH_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000/api/mcp");
    expect(() => getMcpResourceUrl({ BETTER_AUTH_URL: "http://app.example.com" })).toThrow("HTTPS");
  });
});

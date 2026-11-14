import { z } from "zod";
import { addMcpIssues, buildMcpConfig, mcpFormValues, parseToolArguments } from "./mcp-server-fields";

const base = { name: "n", type: "mcp_server", interval: "300" };

function issues(data: Record<string, unknown>): Record<string, string> {
  const found: Record<string, string> = {};
  const ctx = { addIssue: (i: { path: (string | number)[]; message: string }) => { found[String(i.path[0])] = i.message; } } as unknown as z.RefinementCtx;
  addMcpIssues({ interval: "300", ...data }, ctx);
  return found;
}

describe("addMcpIssues", () => {
  it("accepts a bare server", () => expect(issues({})).toEqual({}));

  it("needs a secret for a login and a header name for a custom header", () => {
    expect(issues({ mcpConfig_authType: "bearer" })).toEqual({ mcpConfig_secretKey: "Select a secret" });
    expect(issues({ mcpConfig_authType: "header", mcpConfig_secretKey: "K" })).toEqual({ mcpConfig_headerName: "Enter a header name" });
    expect(issues({ mcpConfig_authType: "header", mcpConfig_secretKey: "K", mcpConfig_headerName: "Host" }).mcpConfig_headerName).toBe("This header name is not allowed");
    expect(issues({ mcpConfig_authType: "header", mcpConfig_secretKey: "K", mcpConfig_headerName: "bad name" }).mcpConfig_headerName).toMatch(/letters/);
    expect(issues({ mcpConfig_authType: "header", mcpConfig_secretKey: "K", mcpConfig_headerName: "X-Api-Key" })).toEqual({});
  });

  it("validates tool names, argument JSON and size, and the tool call", () => {
    expect(issues({ mcpConfig_requiredTools: ["ok_tool", "bad tool"] }).mcpConfig_requiredTools).toMatch(/Tool names/);
    expect(issues({ mcpConfig_requiredTools: Array.from({ length: 51 }, (_, i) => `t${i}`) }).mcpConfig_requiredTools).toMatch(/at most 50/);
    expect(issues({ mcpConfig_toolName: "t", mcpConfig_toolArgs: "[1]" }).mcpConfig_toolArgs).toMatch(/JSON object/);
    expect(issues({ mcpConfig_toolName: "t", mcpConfig_toolArgs: "{nope" }).mcpConfig_toolArgs).toMatch(/JSON object/);
    expect(issues({ mcpConfig_toolName: "t", mcpConfig_toolArgs: JSON.stringify({ a: "x".repeat(9000) }) }).mcpConfig_toolArgs).toMatch(/8 KiB/);
    expect(issues({ mcpConfig_toolName: "t", mcpConfig_toolArgs: '{"q":1}' })).toEqual({});
    expect(issues({ mcpConfig_toolExpect: "ok" }).mcpConfig_toolName).toBe("Enter the tool to call");
  });

  it("limits slow, timeout and the timeout against the interval", () => {
    expect(issues({ mcpConfig_slowMs: "50" }).mcpConfig_slowMs).toBeDefined();
    expect(issues({ mcpConfig_slowMs: "2000" })).toEqual({});
    expect(issues({ mcpConfig_timeoutSeconds: "4" }).mcpConfig_timeoutSeconds).toBeDefined();
    expect(issues({ mcpConfig_timeoutSeconds: "61" }).mcpConfig_timeoutSeconds).toBeDefined();
    expect(issues({ mcpConfig_timeoutSeconds: "30", interval: "10" }).mcpConfig_timeoutSeconds).toMatch(/interval/);
  });
});

describe("buildMcpConfig", () => {
  it("builds the minimal config with the default timeout", () => {
    expect(buildMcpConfig({ ...base })).toEqual({ mcp: { auth: { type: "none" } }, timeoutSeconds: 30 });
  });

  it("carries login, protocol, required tools, tool call and slow limit", () => {
    expect(
      buildMcpConfig({
        ...base,
        mcpConfig_authType: "header",
        mcpConfig_secretKey: " KEY ",
        mcpConfig_headerName: "X-Api-Key",
        mcpConfig_protocol: "2026",
        mcpConfig_requiredTools: ["a", "b"],
        mcpConfig_toolName: "search",
        mcpConfig_toolArgs: '{"q":"ping"}',
        mcpConfig_toolExpect: "pong",
        mcpConfig_slowMs: "1500",
        mcpConfig_timeoutSeconds: "20",
      }),
    ).toEqual({
      mcp: {
        auth: { type: "header", secretKey: "KEY", headerName: "X-Api-Key" },
        protocol: "2026",
        requiredTools: ["a", "b"],
        toolCall: { name: "search", arguments: { q: "ping" }, expectText: "pong" },
        slowMs: 1500,
      },
      timeoutSeconds: 20,
    });
  });

  it("drops stale header and tool-call fields", () => {
    const config = buildMcpConfig({ ...base, mcpConfig_authType: "bearer", mcpConfig_secretKey: "K", mcpConfig_headerName: "X-Old", mcpConfig_protocol: "auto", mcpConfig_toolArgs: '{"q":1}' });
    expect(config).toEqual({ mcp: { auth: { type: "bearer", secretKey: "K" } }, timeoutSeconds: 30 });
  });
});

describe("mcpFormValues and parseToolArguments", () => {
  it("round-trips a stored config", () => {
    const values = mcpFormValues({ timeoutSeconds: 45, mcp: { auth: { type: "bearer", secretKey: "K" }, requiredTools: ["a"], toolCall: { name: "t", arguments: { q: 1 } }, slowMs: 900 } });
    expect(values).toMatchObject({ mcpConfig_authType: "bearer", mcpConfig_secretKey: "K", mcpConfig_requiredTools: ["a"], mcpConfig_toolName: "t", mcpConfig_slowMs: "900", mcpConfig_timeoutSeconds: "45", mcpConfig_protocol: "auto" });
    expect(parseToolArguments(values.mcpConfig_toolArgs)).toEqual({ q: 1 });
  });
  it("defaults an empty config", () => {
    expect(mcpFormValues(undefined)).toMatchObject({ mcpConfig_authType: "none", mcpConfig_timeoutSeconds: "30", mcpConfig_requiredTools: [] });
    expect(parseToolArguments("")).toBeUndefined();
    expect(parseToolArguments("null")).toBeNull();
  });
});

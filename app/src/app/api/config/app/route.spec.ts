/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "./route";

const call = async () => (await GET(new NextRequest("https://app.example.com/api/config/app"))).json();

describe("GET /api/config/app: MCP flag", () => {
  const original = process.env.MCP_SERVER_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_SERVER_ENABLED;
    else process.env.MCP_SERVER_ENABLED = original;
  });

  it("reports the MCP server as off unless it is enabled", async () => {
    delete process.env.MCP_SERVER_ENABLED;
    expect((await call()).mcp).toEqual({ enabled: false });
    process.env.MCP_SERVER_ENABLED = "false";
    expect((await call()).mcp).toEqual({ enabled: false });
  });

  it("reports it as on when enabled, using the same parsing as the server itself", async () => {
    for (const value of ["true", "1", "on"]) {
      process.env.MCP_SERVER_ENABLED = value;
      expect((await call()).mcp).toEqual({ enabled: true });
    }
  });

  it("leaves the rest of the configuration in place", async () => {
    const body = await call();
    expect(body).toEqual(expect.objectContaining({ hosting: expect.any(Object), registration: expect.any(Object), limits: expect.any(Object) }));
  });
});

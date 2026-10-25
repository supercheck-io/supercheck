import { NextRequest } from "next/server";

describe("proxy custom domain routing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      SELF_HOSTED: "true",
      APP_URL: "https://app.supercheck.dev",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rewrites suffix-overlap hostnames as custom domains", async () => {
    process.env.STATUS_PAGE_DOMAIN = "example.com";

    const { proxy } = await import("./proxy");
    const request = new NextRequest("https://myexample.com/", {
      headers: {
        host: "myexample.com",
        "x-forwarded-host": "myexample.com",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/status/custom-domain/myexample.com"
    );
  });

  it("does not treat the reserved status page namespace as a custom domain", async () => {
    process.env.STATUS_PAGE_DOMAIN = "supercheck.example.com";

    const { proxy } = await import("./proxy");
    const request = new NextRequest("https://f134b5f9f2b048069deaf7cfb924a0b3.supercheck.example.com/", {
      headers: {
        host: "f134b5f9f2b048069deaf7cfb924a0b3.supercheck.example.com",
        "x-forwarded-host": "f134b5f9f2b048069deaf7cfb924a0b3.supercheck.example.com",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/status/f134b5f9f2b048069deaf7cfb924a0b3"
    );
  });

  it("keeps ordinary service subdomains out of status routing", async () => {
    process.env.STATUS_PAGE_DOMAIN = "supercheck.example.com";
    const { proxy } = await import("./proxy");
    const request = new NextRequest("https://www.supercheck.example.com/", { headers: { host: "www.supercheck.example.com" } });
    expect(proxy(request).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not treat IPv4 hosts as custom domains", async () => {
    process.env.STATUS_PAGE_DOMAIN = "example.com";

    const { proxy } = await import("./proxy");
    const request = new NextRequest("https://203.0.113.10/", {
      headers: {
        host: "203.0.113.10",
        "x-forwarded-host": "203.0.113.10",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not treat single-label hosts as custom domains", async () => {
    process.env.STATUS_PAGE_DOMAIN = "example.com";

    const { proxy } = await import("./proxy");
    const request = new NextRequest("https://preview/", {
      headers: {
        host: "preview",
        "x-forwarded-host": "preview",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy CORS for the MCP endpoint", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      SELF_HOSTED: "true",
      APP_URL: "https://app.supercheck.dev",
      BETTER_AUTH_URL: "https://app.example.com",
      CORS_ALLOWED_ORIGINS: "https://shared.example.com",
      MCP_ALLOWED_ORIGINS: "https://inspector.example.com",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const preflight = async (path: string, origin: string) => {
    const { proxy } = await import("./proxy");
    return proxy(
      new NextRequest(`https://app.example.com${path}`, {
        method: "OPTIONS",
        headers: { origin, host: "app.example.com" },
      }),
    );
  };

  it.each(["https://app.example.com", "https://inspector.example.com"])(
    "advertises %s for /api/mcp",
    async (origin) => {
      const response = await preflight("/api/mcp", origin);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    },
  );

  it("does not advertise an origin that is only in the general CORS list", async () => {
    const response = await preflight("/api/mcp", "https://shared.example.com");
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps the general CORS list for other API routes", async () => {
    const shared = await preflight("/api/tests", "https://shared.example.com");
    expect(shared.headers.get("access-control-allow-origin")).toBe("https://shared.example.com");
    const inspector = await preflight("/api/tests", "https://inspector.example.com");
    expect(inspector.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still lists the MCP origins when no resource URL is configured", async () => {
    delete process.env.BETTER_AUTH_URL;
    const listed = await preflight("/api/mcp", "https://inspector.example.com");
    expect(listed.headers.get("access-control-allow-origin")).toBe("https://inspector.example.com");
    const own = await preflight("/api/mcp", "https://app.example.com");
    expect(own.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds the MCP exposed headers on a non-preflight request from an allowed origin", async () => {
    const { proxy } = await import("./proxy");
    const response = proxy(
      new NextRequest("https://app.example.com/api/mcp", {
        method: "POST",
        headers: { origin: "https://inspector.example.com", host: "app.example.com" },
      }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("https://inspector.example.com");
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });
});


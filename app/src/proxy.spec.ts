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
    const request = new NextRequest("https://abc123.supercheck.example.com/", {
      headers: {
        host: "abc123.supercheck.example.com",
        "x-forwarded-host": "abc123.supercheck.example.com",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/status/abc123"
    );
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

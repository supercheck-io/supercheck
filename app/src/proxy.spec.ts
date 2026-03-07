import { NextRequest } from "next/server";

describe("status page proxy routing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.SELF_HOSTED = "true";
    process.env.STATUS_PAGE_DOMAIN = "example.com";
    process.env.APP_URL = "https://app.example.com";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("only treats 32-char UUID labels as default status page subdomains", async () => {
    const { __testUtils } = await import("./proxy");

    expect(
      __testUtils.extractSubdomain(
        "f134b5f9f2b048069deaf7cfb924a0b3.example.com"
      )
    ).toBe("f134b5f9f2b048069deaf7cfb924a0b3");

    expect(__testUtils.extractSubdomain("status.example.com")).toBeNull();
  });

  it("does not reject unrelated external domains with overlapping suffixes", async () => {
    const { __testUtils } = await import("./proxy");

    expect(
      __testUtils.isCustomDomain("notexample.com", "app.example.com")
    ).toBe(true);
  });

  it("rewrites external custom domains to the custom status page route", async () => {
    const { proxy } = await import("./proxy");

    const request = new NextRequest("https://status.customer.com/", {
      headers: {
        host: "status.customer.com",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/status/_custom/status.customer.com"
    );
  });

  it("does not rewrite reserved namespace hostnames as custom domains", async () => {
    const { proxy } = await import("./proxy");

    const request = new NextRequest("https://status.example.com/", {
      headers: {
        host: "status.example.com",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
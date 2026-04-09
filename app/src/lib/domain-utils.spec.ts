describe("domain utils", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getStatusPageBaseDomain", () => {
    it("prefers the explicit statusPageDomain override and preserves subdomains", async () => {
      const { getStatusPageBaseDomain } = await import("./domain-utils");

      expect(
        getStatusPageBaseDomain(
          undefined,
          "https://supercheck.example.com:443/path"
        )
      ).toBe("supercheck.example.com");
    });

    it("uses STATUS_PAGE_DOMAIN when no override is provided", async () => {
      process.env.STATUS_PAGE_DOMAIN = "https://status.example.com:443/path";

      const { getStatusPageBaseDomain } = await import("./domain-utils");

      expect(getStatusPageBaseDomain()).toBe("status.example.com");
    });
  });

  describe("getStatusPageUrl", () => {
    it("builds URLs from the full configured status page domain", async () => {
      const { getStatusPageUrl } = await import("./domain-utils");

      expect(
        getStatusPageUrl("abc123", undefined, "supercheck.example.com")
      ).toBe("https://abc123.supercheck.example.com");
    });
  });

  describe("getStatusPageHostname", () => {
    it("builds hostnames from the full configured status page domain", async () => {
      const { getStatusPageHostname } = await import("./domain-utils");

      expect(
        getStatusPageHostname("abc123", undefined, "supercheck.example.com")
      ).toBe("abc123.supercheck.example.com");
    });
  });

  describe("getPublicStatusPageUrl", () => {
    it("falls back to the provided status page domain for default public URLs", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
          statusPageDomain: "supercheck.example.com",
        })
      ).toBe("https://abc123.supercheck.example.com");
    });

    it("returns the verified custom domain unchanged", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
          customDomain: "status.customer.com",
          customDomainVerified: true,
          appUrl: "https://app.supercheck.io",
          statusPageDomain: "supercheck.example.com",
        })
      ).toBe("https://status.customer.com");
    });
  });
});

describe("domain utils", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // normalizeHostname
  // -------------------------------------------------------------------------

  describe("normalizeHostname", () => {
    it("strips protocol, port, path, and trailing dot", async () => {
      const { normalizeHostname } = await import("./domain-utils");

      expect(normalizeHostname("https://Example.COM:443/path")).toBe(
        "example.com"
      );
      expect(normalizeHostname("example.com.")).toBe("example.com");
      expect(normalizeHostname("http://localhost:3000")).toBe("localhost");
    });

    it("returns null for empty or falsy input", async () => {
      const { normalizeHostname } = await import("./domain-utils");

      expect(normalizeHostname("")).toBeNull();
      expect(normalizeHostname(null)).toBeNull();
      expect(normalizeHostname(undefined)).toBeNull();
      expect(normalizeHostname("   ")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // isReservedStatusPageHostnameClient
  // -------------------------------------------------------------------------

  describe("isReservedStatusPageHostnameClient", () => {
    it("detects exact match as reserved", async () => {
      const { isReservedStatusPageHostnameClient } = await import(
        "./domain-utils"
      );

      expect(
        isReservedStatusPageHostnameClient("supercheck.io", "supercheck.io")
      ).toBe(true);
    });

    it("detects subdomain of status page domain as reserved", async () => {
      const { isReservedStatusPageHostnameClient } = await import(
        "./domain-utils"
      );

      expect(
        isReservedStatusPageHostnameClient(
          "abc.supercheck.io",
          "supercheck.io"
        )
      ).toBe(true);
    });

    it("allows unrelated domains", async () => {
      const { isReservedStatusPageHostnameClient } = await import(
        "./domain-utils"
      );

      expect(
        isReservedStatusPageHostnameClient(
          "status.customer.com",
          "supercheck.io"
        )
      ).toBe(false);
    });

    it("prevents suffix overlap (notsupercheck.io)", async () => {
      const { isReservedStatusPageHostnameClient } = await import(
        "./domain-utils"
      );

      expect(
        isReservedStatusPageHostnameClient(
          "notsupercheck.io",
          "supercheck.io"
        )
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getStatusPageUrl
  // -------------------------------------------------------------------------

  describe("getStatusPageUrl", () => {
    it("builds URL from subdomain and status page domain", async () => {
      const { getStatusPageUrl } = await import("./domain-utils");

      expect(getStatusPageUrl("abc123", "supercheck.io")).toBe(
        "https://abc123.supercheck.io"
      );
    });

    it("uses http for localhost", async () => {
      const { getStatusPageUrl } = await import("./domain-utils");

      expect(getStatusPageUrl("abc123", "localhost")).toBe(
        "http://abc123.localhost"
      );
    });

    it("normalizes the domain (strips protocol/port)", async () => {
      const { getStatusPageUrl } = await import("./domain-utils");

      expect(
        getStatusPageUrl("abc123", "https://example.com:443")
      ).toBe("https://abc123.example.com");
    });
  });

  // -------------------------------------------------------------------------
  // getPublicStatusPageUrl
  // -------------------------------------------------------------------------

  describe("getPublicStatusPageUrl", () => {
    it("uses verified custom domains over default subdomain URLs", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
          customDomain: "status.customer.com",
          customDomainVerified: true,
          statusPageDomain: "supercheck.io",
        })
      ).toBe("https://status.customer.com");
    });

    it("falls back to subdomain URL when custom domain is not verified", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
          customDomain: "status.customer.com",
          customDomainVerified: false,
          statusPageDomain: "supercheck.io",
        })
      ).toBe("https://abc123.supercheck.io");
    });

    it("does not derive URLs from NEXT_PUBLIC_APP_URL when statusPageDomain is provided", async () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://app.supercheck.dev";

      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "ac494a3720634224a845178b2422efe7",
          statusPageDomain: "supercheck.io",
        })
      ).toBe("https://ac494a3720634224a845178b2422efe7.supercheck.io");
    });

    it("uses http protocol when appUrl is http", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
          customDomain: "status.customer.com",
          customDomainVerified: true,
          appUrl: "http://localhost:3000",
        })
      ).toBe("http://status.customer.com");
    });

    it("falls back to localhost when no statusPageDomain provided", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "abc123",
        })
      ).toBe("http://abc123.localhost");
    });

    it("uses path-based URLs for self-hosted defaults when routeMode is path", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "ac494a3720634224a845178b2422efe7",
          routeMode: "path",
          appUrl: "https://demo.supercheck.dev",
          statusPageDomain: "demo.supercheck.dev",
        })
      ).toBe("https://demo.supercheck.dev/status/ac494a3720634224a845178b2422efe7");
    });

    it("uses uuid.domain URLs when explicit wildcard routing is enabled", async () => {
      const { getPublicStatusPageUrl } = await import("./domain-utils");

      expect(
        getPublicStatusPageUrl({
          subdomain: "ac494a3720634224a845178b2422efe7",
          routeMode: "subdomain",
          statusPageDomain: "status.example.com",
          appUrl: "https://app.example.com",
        })
      ).toBe("https://ac494a3720634224a845178b2422efe7.status.example.com");
    });
  });
});
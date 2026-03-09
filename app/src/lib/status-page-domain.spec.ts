describe("status page domain utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("normalizeStatusPageDomain", () => {
    it("returns null for empty input", async () => {
      const { normalizeStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(normalizeStatusPageDomain(undefined)).toBeNull();
      expect(normalizeStatusPageDomain("")).toBeNull();
      expect(normalizeStatusPageDomain("   ")).toBeNull();
    });

    it("normalizes URL-like values to hostname", async () => {
      const { normalizeStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(
        normalizeStatusPageDomain("https://Status.Example.com:8443/path")
      ).toBe("status.example.com");
    });

    it("strips trailing dot from hostname", async () => {
      const { normalizeStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(normalizeStatusPageDomain("example.com.")).toBe("example.com");
    });
  });

  describe("getEffectiveStatusPageDomain", () => {
    it("returns cloud default when SELF_HOSTED is not true", async () => {
      delete process.env.SELF_HOSTED;
      process.env.STATUS_PAGE_DOMAIN = "mydomain.com";

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("supercheck.io");
    });

    it("normalizes STATUS_PAGE_DOMAIN in self-hosted mode", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "https://status.example.com:443/";

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("status.example.com");
    });

    it("falls back to localhost in self-hosted mode when unset", async () => {
      process.env.SELF_HOSTED = "true";
      delete process.env.STATUS_PAGE_DOMAIN;
      delete process.env.APP_DOMAIN;
      delete process.env.APP_URL;

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("localhost");
    });

    it("falls back to APP_DOMAIN when STATUS_PAGE_DOMAIN is unset", async () => {
      process.env.SELF_HOSTED = "true";
      delete process.env.STATUS_PAGE_DOMAIN;
      process.env.APP_DOMAIN = "app.example.com";
      delete process.env.APP_URL;

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("app.example.com");
    });

    it("falls back to APP_URL hostname when STATUS_PAGE_DOMAIN and APP_DOMAIN are unset", async () => {
      process.env.SELF_HOSTED = "true";
      delete process.env.STATUS_PAGE_DOMAIN;
      delete process.env.APP_DOMAIN;
      process.env.APP_URL = "https://myapp.example.com:443/path";

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("myapp.example.com");
    });

    it("prefers STATUS_PAGE_DOMAIN over APP_DOMAIN", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.custom.com";
      process.env.APP_DOMAIN = "app.example.com";

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("status.custom.com");
    });
  });

  describe("getStatusPageRouteMode", () => {
    it("uses subdomain routing in cloud mode", async () => {
      delete process.env.SELF_HOSTED;
      delete process.env.STATUS_PAGE_DOMAIN;

      const { getStatusPageRouteMode } = await import("./status-page-domain");

      expect(getStatusPageRouteMode()).toBe("subdomain");
    });

    it("uses path routing by default in self-hosted mode", async () => {
      process.env.SELF_HOSTED = "true";
      delete process.env.STATUS_PAGE_DOMAIN;

      const { getStatusPageRouteMode } = await import("./status-page-domain");

      expect(getStatusPageRouteMode()).toBe("path");
    });

    it("uses subdomain routing in self-hosted mode when STATUS_PAGE_DOMAIN is set", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";

      const { getStatusPageRouteMode } = await import("./status-page-domain");

      expect(getStatusPageRouteMode()).toBe("subdomain");
    });
  });

  describe("getEffectiveAppUrl", () => {
    it("returns APP_URL origin in self-hosted mode", async () => {
      process.env.APP_URL = "https://demo.supercheck.dev/path";

      const { getEffectiveAppUrl } = await import("./status-page-domain");

      expect(getEffectiveAppUrl()).toBe("https://demo.supercheck.dev");
    });
  });

  describe("isReservedStatusPageHostname", () => {
    it("returns true when hostname matches base domain", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(
        isReservedStatusPageHostname("status.example.com", "status.example.com")
      ).toBe(true);
    });

    it("returns true when hostname is a subdomain of base domain", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(
        isReservedStatusPageHostname(
          "foo.status.example.com",
          "status.example.com"
        )
      ).toBe(true);
    });

    it("returns false for external custom domains", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(
        isReservedStatusPageHostname("status.customer.com", "status.example.com")
      ).toBe(false);
    });

    it("returns false for null or undefined inputs", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(isReservedStatusPageHostname(null, "example.com")).toBe(false);
      expect(isReservedStatusPageHostname(undefined, "example.com")).toBe(false);
      expect(isReservedStatusPageHostname("", "example.com")).toBe(false);
    });

    it("is case-insensitive", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(
        isReservedStatusPageHostname("Status.Example.COM", "status.example.com")
      ).toBe(true);
      expect(
        isReservedStatusPageHostname("ABC.STATUS.EXAMPLE.COM", "status.example.com")
      ).toBe(true);
    });

    it("does not match partial suffix overlaps", async () => {
      const { isReservedStatusPageHostname } = await import(
        "./status-page-domain"
      );

      // "notexample.com" should NOT match base domain "example.com"
      expect(
        isReservedStatusPageHostname("notexample.com", "example.com")
      ).toBe(false);
    });
  });
});

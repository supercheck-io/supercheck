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

      const { getEffectiveStatusPageDomain } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageDomain()).toBe("localhost");
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

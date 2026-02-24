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
});

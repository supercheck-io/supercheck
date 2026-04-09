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

  describe("getEffectiveStatusPageCnameTarget", () => {
    it("returns cloud default when SELF_HOSTED is not true", async () => {
      delete process.env.SELF_HOSTED;
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";

      const { getEffectiveStatusPageCnameTarget } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageCnameTarget()).toBe("supercheck.io");
    });

    it("derives a dedicated target from STATUS_PAGE_DOMAIN in self-hosted mode", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";

      const { getEffectiveStatusPageCnameTarget } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageCnameTarget()).toBe(
        "cname.status.example.com"
      );
    });

    it("returns STATUS_PAGE_DOMAIN when it already matches the app hostname", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";
      process.env.APP_URL = "https://status.example.com";

      const { getEffectiveStatusPageCnameTarget } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageCnameTarget()).toBe("status.example.com");
    });

    it("continues honoring legacy STATUS_PAGE_CNAME_TARGET for compatibility", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";
      process.env.STATUS_PAGE_CNAME_TARGET = "cname.status.example.com";

      const { getEffectiveStatusPageCnameTarget } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageCnameTarget()).toBe(
        "cname.status.example.com"
      );
    });

    it("falls back to localhost when STATUS_PAGE_DOMAIN is localhost", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "localhost";

      const { getEffectiveStatusPageCnameTarget } = await import(
        "./status-page-domain"
      );

      expect(getEffectiveStatusPageCnameTarget()).toBe("localhost");
    });
  });

  describe("isPublicStatusPageHostname", () => {
    it("returns false for loopback and single-label hostnames", async () => {
      const { isPublicStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(isPublicStatusPageHostname("localhost")).toBe(false);
      expect(isPublicStatusPageHostname("127.0.0.1")).toBe(false);
      expect(isPublicStatusPageHostname("preview")).toBe(false);
    });

    it("returns true for public multi-label hostnames", async () => {
      const { isPublicStatusPageHostname } = await import(
        "./status-page-domain"
      );

      expect(isPublicStatusPageHostname("cname.status.example.com")).toBe(
        true
      );
    });
  });

  describe("getStatusPageCustomDomainConfigError", () => {
    it("returns an error when self-hosted defaults still point to localhost", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "localhost";

      const { getStatusPageCustomDomainConfigError } = await import(
        "./status-page-domain"
      );

      expect(getStatusPageCustomDomainConfigError()).toBe(
        "Custom domains require a publicly reachable hostname. Set STATUS_PAGE_DOMAIN to a real DNS hostname instead of localhost."
      );
    });

    it("returns null when STATUS_PAGE_DOMAIN is a public hostname", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";

      const { getStatusPageCustomDomainConfigError } = await import(
        "./status-page-domain"
      );

      expect(getStatusPageCustomDomainConfigError()).toBeNull();
    });
  });

  describe("getStatusPageDomainVerificationTargets", () => {
    it("includes the primary target and legacy aliases", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.STATUS_PAGE_DOMAIN = "status.example.com";

      const { getStatusPageDomainVerificationTargets } = await import(
        "./status-page-domain"
      );

      expect(getStatusPageDomainVerificationTargets()).toEqual([
        "cname.status.example.com",
        "status.example.com",
        "ingress.status.example.com",
      ]);
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

/**
 * Registration Feature Flag Tests
 *
 * Tests for isSignupEnabled(), getAllowedEmailDomains(), and isEmailDomainAllowed().
 * Verifies that:
 * - Signup is enabled by default (when SIGNUP_ENABLED is not set)
 * - Signup is only disabled when SIGNUP_ENABLED is explicitly "false" or "0"
 * - ALLOWED_EMAIL_DOMAINS parses and filters email domains correctly
 * - isEmailDomainAllowed correctly validates email addresses
 */

describe("Registration Feature Flags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("isSignupEnabled", () => {
    it("returns true when SIGNUP_ENABLED is not set (default)", async () => {
      delete process.env.SIGNUP_ENABLED;

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(true);
    });

    it("returns true when SIGNUP_ENABLED is empty string", async () => {
      process.env.SIGNUP_ENABLED = "";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(true);
    });

    it("returns true when SIGNUP_ENABLED is 'true'", async () => {
      process.env.SIGNUP_ENABLED = "true";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(true);
    });

    it("returns true when SIGNUP_ENABLED is '1'", async () => {
      process.env.SIGNUP_ENABLED = "1";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(true);
    });

    it("returns true when SIGNUP_ENABLED is 'yes'", async () => {
      process.env.SIGNUP_ENABLED = "yes";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(true);
    });

    it("returns false when SIGNUP_ENABLED is 'false'", async () => {
      process.env.SIGNUP_ENABLED = "false";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(false);
    });

    it("returns false when SIGNUP_ENABLED is 'FALSE' (case insensitive)", async () => {
      process.env.SIGNUP_ENABLED = "FALSE";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(false);
    });

    it("returns false when SIGNUP_ENABLED is '0'", async () => {
      process.env.SIGNUP_ENABLED = "0";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(false);
    });

    it("returns false when SIGNUP_ENABLED is 'False' (mixed case)", async () => {
      process.env.SIGNUP_ENABLED = "False";

      const { isSignupEnabled } = await import("./feature-flags");
      expect(isSignupEnabled()).toBe(false);
    });
  });

  describe("getAllowedEmailDomains", () => {
    it("returns empty array when ALLOWED_EMAIL_DOMAINS is not set", async () => {
      delete process.env.ALLOWED_EMAIL_DOMAINS;

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual([]);
    });

    it("returns empty array when ALLOWED_EMAIL_DOMAINS is empty string", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual([]);
    });

    it("returns empty array when ALLOWED_EMAIL_DOMAINS is whitespace only", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "   ";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual([]);
    });

    it("parses a single domain", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual(["acme.com"]);
    });

    it("parses multiple comma-separated domains", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com,example.org,test.io";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual(["acme.com", "example.org", "test.io"]);
    });

    it("trims whitespace around domains", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "  acme.com , example.org , test.io  ";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual(["acme.com", "example.org", "test.io"]);
    });

    it("lowercases domains", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "ACME.COM,Example.Org";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual(["acme.com", "example.org"]);
    });

    it("filters out empty entries from trailing commas", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com,,example.org,";

      const { getAllowedEmailDomains } = await import("./feature-flags");
      expect(getAllowedEmailDomains()).toEqual(["acme.com", "example.org"]);
    });
  });

  describe("isEmailDomainAllowed", () => {
    it("returns true when no domain restriction is set", async () => {
      delete process.env.ALLOWED_EMAIL_DOMAINS;

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@anything.com")).toBe(true);
    });

    it("returns true when email domain matches allowed list", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com,example.org";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@acme.com")).toBe(true);
    });

    it("returns true when email domain matches with different case", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@ACME.COM")).toBe(true);
    });

    it("returns false when email domain is not in allowed list", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com,example.org";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@evil.com")).toBe(false);
    });

    it("returns false for email without @ symbol", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("useratacme.com")).toBe(false);
    });

    it("returns false for email with empty domain part", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@")).toBe(false);
    });

    it("returns true for second domain in list", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com,example.org";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("admin@example.org")).toBe(true);
    });

    it("handles subdomain correctly - subdomain is not a match", async () => {
      process.env.ALLOWED_EMAIL_DOMAINS = "acme.com";

      const { isEmailDomainAllowed } = await import("./feature-flags");
      expect(isEmailDomainAllowed("user@sub.acme.com")).toBe(false);
    });
  });
});

/**
 * CAPTCHA Feature Flag Tests
 *
 * Tests for isCaptchaEnabled() and getTurnstileSiteKey() functions.
 * Verifies that:
 * - CAPTCHA is always disabled for self-hosted deployments
 * - CAPTCHA is enabled only in cloud mode with both Turnstile keys set
 * - getTurnstileSiteKey returns null when CAPTCHA is disabled
 */

describe("CAPTCHA Feature Flags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("isCaptchaEnabled", () => {
    it("returns false when SELF_HOSTED=true even if Turnstile keys are set", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns false when SELF_HOSTED=1 even if Turnstile keys are set", async () => {
      process.env.SELF_HOSTED = "1";
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns false when SELF_HOSTED=TRUE (case insensitive)", async () => {
      process.env.SELF_HOSTED = "TRUE";
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns true in cloud mode when both Turnstile keys are set", async () => {
      delete process.env.SELF_HOSTED;
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(true);
    });

    it("returns true when SELF_HOSTED=false (cloud mode) and keys are set", async () => {
      process.env.SELF_HOSTED = "false";
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(true);
    });

    it("returns false in cloud mode when TURNSTILE_SECRET_KEY is not set", async () => {
      delete process.env.SELF_HOSTED;
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns false in cloud mode when TURNSTILE_SITE_KEY is not set", async () => {
      delete process.env.SELF_HOSTED;
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      delete process.env.TURNSTILE_SITE_KEY;

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns false in cloud mode when neither Turnstile key is set", async () => {
      delete process.env.SELF_HOSTED;
      delete process.env.TURNSTILE_SECRET_KEY;
      delete process.env.TURNSTILE_SITE_KEY;

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });

    it("returns false when SELF_HOSTED is empty string (cloud mode) but no keys", async () => {
      process.env.SELF_HOSTED = "";
      delete process.env.TURNSTILE_SECRET_KEY;
      delete process.env.TURNSTILE_SITE_KEY;

      const { isCaptchaEnabled } = await import("./feature-flags");
      expect(isCaptchaEnabled()).toBe(false);
    });
  });

  describe("getTurnstileSiteKey", () => {
    it("returns null for self-hosted deployments even with keys configured", async () => {
      process.env.SELF_HOSTED = "true";
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { getTurnstileSiteKey } = await import("./feature-flags");
      expect(getTurnstileSiteKey()).toBeNull();
    });

    it("returns site key in cloud mode when CAPTCHA is enabled", async () => {
      delete process.env.SELF_HOSTED;
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
      process.env.TURNSTILE_SITE_KEY = "test-site-key";

      const { getTurnstileSiteKey } = await import("./feature-flags");
      expect(getTurnstileSiteKey()).toBe("test-site-key");
    });

    it("returns null in cloud mode when CAPTCHA is not configured", async () => {
      delete process.env.SELF_HOSTED;
      delete process.env.TURNSTILE_SECRET_KEY;
      delete process.env.TURNSTILE_SITE_KEY;

      const { getTurnstileSiteKey } = await import("./feature-flags");
      expect(getTurnstileSiteKey()).toBeNull();
    });
  });
});

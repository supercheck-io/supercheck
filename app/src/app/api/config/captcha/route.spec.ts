/**
 * CAPTCHA Config API Route Tests
 *
 * Tests for GET /api/config/captcha endpoint.
 * Verifies that:
 * - Self-hosted deployments always return { enabled: false }
 * - Cloud deployments return correct CAPTCHA configuration
 * - Site key is only included when CAPTCHA is enabled
 */

describe("GET /api/config/captcha", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns enabled: false for self-hosted deployments even with keys set", async () => {
    process.env.SELF_HOSTED = "true";
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    process.env.TURNSTILE_SITE_KEY = "test-site-key";

    // Re-import to pick up env changes
    jest.resetModules();
    const { GET: getHandler } = await import("./route");
    const response = await getHandler();
    const data = await response.json();

    expect(data.enabled).toBe(false);
    expect(data.siteKey).toBeUndefined();
  });

  it("returns enabled: true with siteKey for cloud mode with keys", async () => {
    delete process.env.SELF_HOSTED;
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    process.env.TURNSTILE_SITE_KEY = "test-site-key";

    jest.resetModules();
    const { GET: getHandler } = await import("./route");
    const response = await getHandler();
    const data = await response.json();

    expect(data.enabled).toBe(true);
    expect(data.siteKey).toBe("test-site-key");
  });

  it("returns enabled: false for cloud mode without keys", async () => {
    delete process.env.SELF_HOSTED;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITE_KEY;

    jest.resetModules();
    const { GET: getHandler } = await import("./route");
    const response = await getHandler();
    const data = await response.json();

    expect(data.enabled).toBe(false);
    expect(data.siteKey).toBeUndefined();
  });

  it("returns enabled: false when only secret key is set", async () => {
    delete process.env.SELF_HOSTED;
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    delete process.env.TURNSTILE_SITE_KEY;

    jest.resetModules();
    const { GET: getHandler } = await import("./route");
    const response = await getHandler();
    const data = await response.json();

    expect(data.enabled).toBe(false);
    expect(data.siteKey).toBeUndefined();
  });

  it("returns enabled: false when only site key is set", async () => {
    delete process.env.SELF_HOSTED;
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SITE_KEY = "test-site-key";

    jest.resetModules();
    const { GET: getHandler } = await import("./route");
    const response = await getHandler();
    const data = await response.json();

    expect(data.enabled).toBe(false);
    expect(data.siteKey).toBeUndefined();
  });
});

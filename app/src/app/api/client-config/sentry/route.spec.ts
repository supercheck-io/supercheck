/**
 * GET /api/client-config/sentry: runtime browser config, off unless cloud + DSN.
 */
const sdkLoaded = jest.fn();
jest.mock("@sentry/react", () => {
  sdkLoaded();
  return {};
});
jest.mock("@sentry/node", () => {
  sdkLoaded();
  return {};
});

const DSN = "https://abc@o1.ingest.sentry.io/1";

describe("GET /api/client-config/sentry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SENTRY_DSN;
    delete process.env.SELF_HOSTED;
    process.env.APP_URL = "https://app.example.com";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function get(host = "app.example.com") {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://internal/api/client-config/sentry", { headers: { host } }));
    return { response, data: await response.json() };
  }

  it("returns {} without a DSN", async () => {
    const { response, data } = await get();
    expect(data).toEqual({});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns {} when self-hosted even with a DSN", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "true";
    expect((await get()).data).toEqual({});
  });

  it("returns runtime config on cloud with a DSN", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    process.env.SENTRY_ENVIRONMENT = "staging";
    process.env.SENTRY_RELEASE = "1.2.3";
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.2";
    process.env.SENTRY_REPLAY_SESSION_SAMPLE_RATE = "abc";
    process.env.SENTRY_REPLAY_ERROR_SAMPLE_RATE = "1";
    expect((await get()).data).toEqual({
      dsn: DSN,
      environment: "staging",
      release: "1.2.3",
      tracesSampleRate: 0.2,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
    });
  });

  it("returns {} on a status-page subdomain or custom domain", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    expect((await get("0b5c1b4e-7d3e-4c1a-9f7e-2a1b3c4d5e6f.status.example.com")).data).toEqual({});
    expect((await get("status.customer.com")).data).toEqual({});
    expect((await get("app.example.com:443")).data).toHaveProperty("dsn", DSN);
  });

  it("never loads the Sentry SDK", async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = "false";
    await get();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });
});

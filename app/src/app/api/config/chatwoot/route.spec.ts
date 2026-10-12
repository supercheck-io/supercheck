/**
 * @jest-environment node
 */
const mockIsCloudHosted = jest.fn();

jest.mock("@/lib/feature-flags", () => ({
  isCloudHosted: () => mockIsCloudHosted(),
}));

import { GET } from "./route";

describe("GET /api/config/chatwoot", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it("is disabled when self-hosted", async () => {
    mockIsCloudHosted.mockReturnValue(false);
    process.env.CHATWOOT_BASE_URL = "https://app.chatwoot.com";
    process.env.CHATWOOT_WEBSITE_TOKEN = "tok";
    expect(await (await GET()).json()).toEqual({ enabled: false, baseUrl: null, websiteToken: null });
  });

  it("is enabled in cloud mode with valid config", async () => {
    mockIsCloudHosted.mockReturnValue(true);
    process.env.CHATWOOT_BASE_URL = "https://app.chatwoot.com";
    process.env.CHATWOOT_WEBSITE_TOKEN = "tok";
    expect(await (await GET()).json()).toEqual({
      enabled: true,
      baseUrl: "https://app.chatwoot.com",
      websiteToken: "tok",
    });
  });

  it("is disabled when the token is missing or the URL is invalid", async () => {
    mockIsCloudHosted.mockReturnValue(true);
    process.env.CHATWOOT_BASE_URL = "not-a-url";
    process.env.CHATWOOT_WEBSITE_TOKEN = "tok";
    expect((await (await GET()).json()).enabled).toBe(false);

    process.env.CHATWOOT_BASE_URL = "https://app.chatwoot.com";
    delete process.env.CHATWOOT_WEBSITE_TOKEN;
    expect((await (await GET()).json()).enabled).toBe(false);
  });
});

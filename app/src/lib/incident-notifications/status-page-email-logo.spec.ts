import { statusPageEmailLogoUrl } from "./status-page-email-logo";

jest.mock("@/lib/asset-proxy", () => ({
  generateProxyUrl: (ref: string | null | undefined) => (ref ? (ref.startsWith("status-bucket/") ? `/api/assets/${ref.slice("status-bucket/".length)}` : ref) : null),
}));

describe("statusPageEmailLogoUrl", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_URL = "https://app.io/"; });
  afterAll(() => { if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = prev; });

  it("makes a stored logo an absolute link on the app's public asset route", () => {
    expect(statusPageEmailLogoUrl("status-bucket/status-pages/p1/logo.png")).toBe("https://app.io/api/assets/status-pages/p1/logo.png");
  });

  it("keeps an absolute logo URL", () => {
    expect(statusPageEmailLogoUrl("https://cdn.acme.io/logo.png")).toBe("https://cdn.acme.io/logo.png");
  });

  it("returns nothing for no logo or a reference mail clients cannot load", () => {
    expect(statusPageEmailLogoUrl(null)).toBeUndefined();
    expect(statusPageEmailLogoUrl(undefined)).toBeUndefined();
    expect(statusPageEmailLogoUrl("other-bucket/logo.png")).toBeUndefined();
  });
});

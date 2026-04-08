import {
  getAllowedCorsOriginPatterns,
  isCorsOriginAllowed,
  parseCorsOriginPattern,
} from "./cors";

describe("cors origin parsing", () => {
  it("normalizes exact origins and strips trailing slashes", () => {
    expect(parseCorsOriginPattern("https://dev.azure.com/")).toEqual({
      type: "exact",
      origin: "https://dev.azure.com",
    });
  });

  it("parses wildcard subdomain patterns", () => {
    expect(parseCorsOriginPattern("https://*.visualstudio.com")).toEqual({
      type: "wildcard",
      protocol: "https:",
      hostnameSuffix: "visualstudio.com",
      port: "",
    });
  });

  it("normalizes wildcard patterns with trailing slashes and default ports", () => {
    expect(parseCorsOriginPattern("https://*.visualstudio.com:443/")).toEqual({
      type: "wildcard",
      protocol: "https:",
      hostnameSuffix: "visualstudio.com",
      port: "",
    });
  });

  it("ignores invalid wildcard patterns", () => {
    expect(parseCorsOriginPattern("https://dev.*.example.com")).toBeNull();
  });
});

describe("cors origin matching", () => {
  it("matches normalized exact origins", () => {
    const allowedOrigins = getAllowedCorsOriginPatterns({
      APP_URL: "https://supercheck.example.com/app",
    });

    expect(
      isCorsOriginAllowed("https://supercheck.example.com", allowedOrigins)
    ).toBe(true);
  });

  it("matches wildcard Azure DevOps origins", () => {
    const allowedOrigins = getAllowedCorsOriginPatterns({
      CORS_ALLOWED_ORIGINS:
        "https://dev.azure.com,https://*.visualstudio.com",
    });

    expect(
      isCorsOriginAllowed(
        "https://clinicalsupportsystems.visualstudio.com",
        allowedOrigins
      )
    ).toBe(true);
    expect(isCorsOriginAllowed("https://visualstudio.com", allowedOrigins)).toBe(
      false
    );
  });

  it("matches wildcard origins configured with a default port or trailing slash", () => {
    const allowedOrigins = getAllowedCorsOriginPatterns({
      CORS_ALLOWED_ORIGINS: "https://*.visualstudio.com:443/",
    });

    expect(
      isCorsOriginAllowed(
        "https://clinicalsupportsystems.visualstudio.com",
        allowedOrigins
      )
    ).toBe(true);
  });

  it("preserves non-default wildcard ports", () => {
    const allowedOrigins = getAllowedCorsOriginPatterns({
      CORS_ALLOWED_ORIGINS: "https://*.example.com:8443/",
    });

    expect(
      isCorsOriginAllowed("https://status.example.com:8443", allowedOrigins)
    ).toBe(true);
    expect(
      isCorsOriginAllowed("https://status.example.com", allowedOrigins)
    ).toBe(false);
  });

  it("rejects invalid origins", () => {
    const allowedOrigins = getAllowedCorsOriginPatterns({
      CORS_ALLOWED_ORIGINS: "https://dev.azure.com",
    });

    expect(isCorsOriginAllowed("not-an-origin", allowedOrigins)).toBe(false);
  });
});

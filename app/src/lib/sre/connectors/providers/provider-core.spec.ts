/** @jest-environment node */
import {
  assertVendorUrl,
  clearProviderTokenCache,
  parseKeyValueTokens,
  readAccessToken,
  readCachedToken,
  requestJson,
  writeCachedToken,
} from "./provider-core";
import { makeContext, mockHttp } from "./provider-test-utils";

describe("provider core", () => {
  it.each([
    "https://api.newrelic.com/graphql",
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    "https://oauth2.googleapis.com/token",
  ])("allows vendor host %s", (url) => {
    expect(() => assertVendorUrl(url)).not.toThrow();
  });

  it.each([
    "http://api.newrelic.com/graphql",
    "https://api.newrelic.com.evil.com/graphql",
    "https://evil.com/oauth2/token",
    "https://user:pw@api.newrelic.com/graphql",
    "https://api.newrelic.com:8443/graphql",
    "https://169.254.169.254/latest",
  ])("rejects non-vendor target %s", (url) => {
    expect(() => assertVendorUrl(url)).toThrow(/not allowed/);
  });

  it("parses quoted key value tokens", () => {
    expect(parseKeyValueTokens('a=1 b="x y" rest').values).toEqual({ a: "1", b: "x y" });
  });

  it("expires cached tokens a minute early", () => {
    clearProviderTokenCache();
    writeCachedToken("k", "tok", 3600, 0);
    expect(readCachedToken("k", 1000)).toBe("tok");
    expect(readCachedToken("k", 3600 * 1000)).toBeNull();
  });

  it("maps oauth failures without echoing the body", () => {
    expect(() => readAccessToken("X", { status: 401, text: '{"error_description":"AADSTS7000215 bad secret\\nTrace ID"}', truncated: false })).toThrow(/invalid credentials: X rejected the sign-in \(AADSTS7000215 bad secret\)/);
    expect(() => readAccessToken("X", { status: 200, text: "{}", truncated: false })).toThrow(/no access token/);
    expect(() => readAccessToken("X", { status: 503, text: "", truncated: false })).toThrow(/HTTP 503/);
  });

  it("maps http errors and truncation", async () => {
    const req = { url: "https://x", method: "GET" as const, headers: {}, timeoutMs: 1, maxBytes: 1, target: "endpoint" as const };
    await expect(requestJson(makeContext(mockHttp([{ status: 403 }]).http), "P", req)).rejects.toThrow(/credentials rejected with HTTP 403/);
    await expect(requestJson(makeContext(mockHttp([{ status: 429 }]).http), "P", req)).rejects.toThrow(/rate limit/);
    const bodyReq = { ...req };
    await expect(requestJson(makeContext(mockHttp([{ status: 400, text: "internal hint" }]).http), "P", bodyReq)).rejects.toThrow(/^Error: P rejected the request with HTTP 400$|P rejected the request with HTTP 400$/);
    await expect(requestJson(makeContext(mockHttp([{ status: 400, text: "bad query" }]).http), "P", { ...req, target: "vendor" })).rejects.toThrow(/HTTP 400: bad query/);
    await expect(requestJson(makeContext(mockHttp([{ status: 500, text: "secret stack" }]).http), "P", req)).rejects.toThrow(/^Error: P request failed with HTTP 500$|P request failed with HTTP 500$/);
    await expect(requestJson(makeContext(mockHttp([{ text: "{", truncated: true }]).http), "P", req)).rejects.toThrow(/size budget/);
    await expect(requestJson(makeContext(mockHttp([{ text: "<html>" }]).http), "P", req)).rejects.toThrow(/not valid JSON/);
  });
});

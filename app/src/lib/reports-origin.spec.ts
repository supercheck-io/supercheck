/** @jest-environment node */
import {
  buildReportUrl,
  getReportsOrigin,
  isReportsHost,
  mintReportToken,
  verifyReportToken,
} from "./reports-origin";

const ENTITY = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

describe("report token", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("verifies a freshly minted token and returns the bound project", () => {
    expect(verifyReportToken(mintReportToken(ENTITY, PROJECT), ENTITY)).toEqual({ projectId: PROJECT });
  });

  it("rejects an expired token", () => {
    const t = mintReportToken(ENTITY, PROJECT, 1_000_000, 60);
    expect(verifyReportToken(t, ENTITY, 1_000_000 + 59_000)).not.toBeNull();
    expect(verifyReportToken(t, ENTITY, 1_000_000 + 60_000)).toBeNull();
  });

  it("rejects a token for another report", () => {
    expect(verifyReportToken(mintReportToken(ENTITY, PROJECT), "other-entity")).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const t = mintReportToken(ENTITY, PROJECT);
    const [body, sig] = t.slice(1).split(".");
    const forged = Buffer.from(
      JSON.stringify({ e: ENTITY, p: "another-project", x: 9_999_999_999 })
    ).toString("base64url");
    expect(verifyReportToken(`~${forged}.${sig}`, ENTITY)).toBeNull();
    expect(verifyReportToken(`~${body}.${sig.slice(0, -2)}AA`, ENTITY)).toBeNull();
    expect(verifyReportToken(`~${body}`, ENTITY)).toBeNull();
    expect(verifyReportToken("garbage", ENTITY)).toBeNull();
  });

  it("rejects a token signed with a different key", () => {
    const t = mintReportToken(ENTITY, PROJECT);
    process.env.SECRET_ENCRYPTION_KEY = "b".repeat(64);
    expect(verifyReportToken(t, ENTITY)).toBeNull();
  });
});

describe("reports origin config", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("is off when unset, empty or invalid", () => {
    delete process.env.REPORTS_ORIGIN;
    expect(getReportsOrigin()).toBeNull();
    process.env.REPORTS_ORIGIN = " ";
    expect(getReportsOrigin()).toBeNull();
    process.env.REPORTS_ORIGIN = "not a url";
    expect(getReportsOrigin()).toBeNull();
  });

  it("normalizes to an origin and matches the request host", () => {
    process.env.REPORTS_ORIGIN = "https://reports.example.net/";
    expect(getReportsOrigin()).toBe("https://reports.example.net");
    expect(isReportsHost(new Request("https://reports.example.net/x"))).toBe(true);
    expect(isReportsHost(new Request("https://app.example.com/x"))).toBe(false);
    expect(
      isReportsHost(
        new Request("http://internal/x", { headers: { "x-forwarded-host": "reports.example.net" } })
      )
    ).toBe(true);
  });

  it("ignores a value equal to the app host", () => {
    process.env.REPORTS_ORIGIN = "https://app.example.com";
    process.env.APP_URL = "https://app.example.com";
    expect(getReportsOrigin()).toBeNull();
  });

  it("fails closed when X-Forwarded-Host is forged to the app host", () => {
    process.env.REPORTS_ORIGIN = "https://reports.example.net";
    const forged = new Request("https://reports.example.net/x", {
      headers: { "x-forwarded-host": "app.example.com" },
    });
    expect(isReportsHost(forged)).toBe(true);
  });

  it("builds the signed URL under the test-results path", () => {
    expect(buildReportUrl("https://r.example", "~t.s", "/id/report/index.html")).toBe(
      "https://r.example/api/test-results/~t.s/id/report/index.html"
    );
  });
});

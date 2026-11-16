import { scanMatchesUrl } from "./step-types";
import type { ScanSummary } from "@/lib/setup/scan";

const scan = (finalUrl: string) => ({ finalUrl }) as unknown as ScanSummary;

describe("scanMatchesUrl", () => {
  it("matches the same host, www and same-site subdomain redirects", () => {
    expect(scanMatchesUrl(scan("https://example.com/"), "https://example.com")).toBe(true);
    expect(scanMatchesUrl(scan("https://www.example.com/"), "https://example.com")).toBe(true);
    expect(scanMatchesUrl(scan("https://app.example.com/login"), "https://example.com")).toBe(true);
  });
  it("rejects another site, look-alike suffixes, missing values and bad URLs", () => {
    expect(scanMatchesUrl(scan("https://other.com/"), "https://example.com")).toBe(false);
    expect(scanMatchesUrl(scan("https://notexample.com/"), "https://example.com")).toBe(false);
    expect(scanMatchesUrl(null, "https://example.com")).toBe(false);
    expect(scanMatchesUrl(scan("https://example.com/"), "")).toBe(false);
    expect(scanMatchesUrl(scan("not a url"), "https://example.com")).toBe(false);
  });

  it("matches a cross-domain redirect by the URL it was submitted for, and rejects another URL", () => {
    expect(scanMatchesUrl(scan("https://other.example.net/"), "https://app.example.com/", "https://app.example.com/")).toBe(true);
    expect(scanMatchesUrl(scan("https://app.example.com/"), "https://changed.example.org/", "https://app.example.com/")).toBe(false);
  });
});

import { monitorPrefill } from "./monitor-prefill";

const q = (s: string) => new URLSearchParams(s);

describe("monitorPrefill", () => {
  it("fills target and name for a website monitor", () => {
    expect(monitorPrefill(q("type=website&url=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&name=ex.com"), "website")).toEqual({
      target: "https://ex.com/a?b=1",
      name: "ex.com",
    });
  });

  it("fills GET or HEAD for an HTTP monitor only", () => {
    expect(monitorPrefill(q("url=https%3A%2F%2Fapi.ex.com&method=HEAD"), "http_request")).toEqual({
      target: "https://api.ex.com",
      httpConfig_method: "HEAD",
    });
    expect(monitorPrefill(q("url=https%3A%2F%2Fex.com&method=HEAD"), "website")).toEqual({ target: "https://ex.com" });
    expect(monitorPrefill(q("method=POST"), "http_request")).toEqual({});
  });

  it("ignores non-http URLs, oversized values and other monitor types", () => {
    expect(monitorPrefill(q("url=javascript%3Aalert(1)"), "website")).toEqual({});
    expect(monitorPrefill(q(`url=https%3A%2F%2F${"a".repeat(2100)}`), "website")).toEqual({});
    expect(monitorPrefill(q("url=https%3A%2F%2Fex.com"), "ping_host")).toEqual({});
    expect(monitorPrefill(null, "website")).toEqual({});
    expect(monitorPrefill(q(`name=${"n".repeat(150)}`), "website").name).toHaveLength(100);
  });
});

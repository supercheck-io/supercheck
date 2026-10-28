import { contrastRatio, resolveBranding } from "./status-page-branding";

describe("resolveBranding", () => {
  it("keeps the theme for stored defaults and nulls", () => {
    expect(resolveBranding({ cssBodyBackgroundColor: "#FFFFFF", cssFontColor: "#333333", cssNoData: "#bdc3c7" })).toEqual({ page: null, noData: null });
    expect(resolveBranding({})).toEqual({ page: null, noData: null });
  });

  it("applies a custom background with readable custom text", () => {
    const { page } = resolveBranding({ cssBodyBackgroundColor: "#112233", cssFontColor: "#eeeeee", cssLightFontColor: "#cccccc", cssBorderColor: "#445566" });
    expect(page).toEqual({ background: "#112233", font: "#eeeeee", lightFont: "#cccccc", border: "#445566" });
  });

  it("falls back to black or white text when the configured pair is unreadable", () => {
    expect(resolveBranding({ cssBodyBackgroundColor: "#111111", cssFontColor: "#222222" }).page?.font).toBe("#ffffff");
    expect(resolveBranding({ cssBodyBackgroundColor: "#f5f5f5", cssFontColor: "#fafafa" }).page?.font).toBe("#000000");
  });

  it("ignores a custom font without a custom background and rejects invalid hex", () => {
    expect(resolveBranding({ cssFontColor: "#ff0000" }).page).toBeNull();
    expect(resolveBranding({ cssBodyBackgroundColor: "red", cssNoData: "url(x)" })).toEqual({ page: null, noData: null });
  });

  it("applies a custom no-data colour", () => {
    expect(resolveBranding({ cssNoData: "#778899" }).noData).toBe("#778899");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
});

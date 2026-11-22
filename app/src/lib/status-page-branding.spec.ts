import { bannerColors, contrastRatio, normalizeHexColor, readableTextOn, resolveBranding } from "./status-page-branding";

describe("resolveBranding", () => {
  it("keeps the theme for stored defaults and nulls", () => {
    expect(resolveBranding({ cssBodyBackgroundColor: "#FFFFFF", cssFontColor: "#333333", cssNoData: "#bdc3c7" })).toEqual({ page: null, noData: null });
    expect(resolveBranding({})).toEqual({ page: null, noData: null });
  });

  it("applies a custom background with readable custom text", () => {
    const { page } = resolveBranding({ cssBodyBackgroundColor: "#112233", cssFontColor: "#eeeeee", cssLightFontColor: "#cccccc", cssBorderColor: "#778899" });
    expect(page).toEqual({ background: "#112233", font: "#eeeeee", lightFont: "#cccccc", border: "#778899" });
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

describe("hex normalisation", () => {
  it("expands #rgb and rejects everything else", () => {
    expect(normalizeHexColor("#AbC")).toBe("#AAbbCC");
    expect(normalizeHexColor(" #112233 ")).toBe("#112233");
    for (const bad of ["#12", "#1234", "#12345g", "red", "112233", "", null, undefined]) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it("accepts #rgb in branding", () => {
    expect(resolveBranding({ cssBodyBackgroundColor: "#123" }).page?.background).toBe("#112233");
  });
});

describe("border colour", () => {
  const bg = { cssBodyBackgroundColor: "#eeeeee", cssFontColor: "#000000" };
  it("keeps a high-contrast border", () => {
    expect(resolveBranding({ ...bg, cssBorderColor: "#555555" }).page?.border).toBe("#555555");
  });
  it("keeps the owner's border even when it is low contrast", () => {
    expect(resolveBranding({ ...bg, cssBorderColor: "#fefefe" }).page?.border).toBe("#fefefe");
  });
  it("derives plain colours when no border is set", () => {
    const page = resolveBranding({ cssBodyBackgroundColor: "#eeeeee" }).page!;
    expect(page.border).toMatch(/^#[0-9a-f]{6}$/);
    expect(page.lightFont).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("readableTextOn", () => {
  it.each(["#2ecc71", "#f1c40f", "#e67e22", "#3498db", "#e74c3c", "#9ca3af", "#2ec", "#777777", "#7c7c7c", "#767676"])("keeps banner text at 4.5:1 or better on %s", (bg) => {
    expect(contrastRatio(readableTextOn(bg), normalizeHexColor(bg)!)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses white on a dark custom colour and near-black for junk", () => {
    expect(readableTextOn("#14532d")).toBe("#ffffff");
    expect(readableTextOn("green")).toBe("#111827");
  });
});

describe("bannerColors", () => {
  it("darkens the default status colours just enough for white text", () => {
    for (const bg of ["#2ecc71", "#e67e22", "#3498db", "#e74c3c"]) {
      const { background, text } = bannerColors(bg);
      expect(text).toBe("#ffffff");
      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(bannerColors("#e74c3c").background).not.toBe("#1e874b");
  });

  it("keeps a light colour such as yellow with dark text instead of turning it brown", () => {
    const { background, text } = bannerColors("#f1c40f");
    expect(background).toBe("#f1c40f");
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
  });
});

it("bannerColors keeps an unparseable colour and picks readable text", () => {
  expect(bannerColors("red")).toEqual({ background: "red", text: readableTextOn("red") });
});

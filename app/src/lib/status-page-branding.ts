// Schema defaults (src/db/schema/statusPage.ts). A stored default means "not customised".
const DEFAULTS = { bg: "#ffffff", font: "#333333", lightFont: "#666666", border: "#ecf0f1", noData: "#bdc3c7" };
const HEX = /^#[0-9a-f]{6}$/i;
const MIN_TEXT_CONTRAST = 4.5;

type BrandingInput = {
  cssBodyBackgroundColor?: string | null;
  cssFontColor?: string | null;
  cssLightFontColor?: string | null;
  cssBorderColor?: string | null;
  cssNoData?: string | null;
};

export type StatusPageBranding = {
  /** Page-wide colours; null keeps the light/dark theme. */
  page: { background: string; font: string; lightFont: string; border: string | null } | null;
  noData: string | null;
};

const custom = (value: string | null | undefined, fallback: string) =>
  value && HEX.test(value) && value.toLowerCase() !== fallback ? value : null;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Colours are applied only when the owner customised the page background: a custom font
 * alone cannot be checked against the viewer's light/dark theme, so it keeps the theme.
 * Text that fails WCAG AA against the custom background falls back to black or white.
 */
export function resolveBranding(page: BrandingInput): StatusPageBranding {
  const background = custom(page.cssBodyBackgroundColor, DEFAULTS.bg);
  const readable = (color: string | null, fallback: string) =>
    color && contrastRatio(color, background!) >= MIN_TEXT_CONTRAST ? color : fallback;
  let pageColors: StatusPageBranding["page"] = null;
  if (background) {
    const auto = contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff";
    const font = readable(custom(page.cssFontColor, DEFAULTS.font), auto);
    pageColors = {
      background,
      font,
      lightFont: readable(custom(page.cssLightFontColor, DEFAULTS.lightFont), font),
      border: custom(page.cssBorderColor, DEFAULTS.border),
    };
  }
  return { page: pageColors, noData: custom(page.cssNoData, DEFAULTS.noData) };
}

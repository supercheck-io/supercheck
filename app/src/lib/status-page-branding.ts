// Schema defaults (src/db/schema/statusPage.ts). A stored default means "not customised".
const DEFAULTS = { bg: "#ffffff", font: "#333333", lightFont: "#666666", border: "#ecf0f1", noData: "#bdc3c7" };
/** `#rgb` or `#rrggbb`. */
export const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Expands `#rgb` to `#rrggbb`; null when the value is not a hex colour. */
export function normalizeHexColor(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || !HEX_COLOR_REGEX.test(v)) return null;
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

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
  page: { background: string; font: string; lightFont: string; border: string } | null;
  noData: string | null;
};

const custom = (value: string | null | undefined, fallback: string) => {
  const hex = normalizeHexColor(value);
  return hex && hex.toLowerCase() !== fallback ? hex : null;
};

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Plain `#rrggbb` blend of `a` over `b` (a solid page background), so no CSS color-mix() support is needed. */
function mix(a: string, b: string, weightOfA: number) {
  const ch = (i: number) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * weightOfA + parseInt(b.slice(i, i + 2), 16) * (1 - weightOfA));
  return `#${[1, 3, 5].map((i) => ch(i).toString(16).padStart(2, "0")).join("")}`;
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
    // Borders are decorative, so the owner's choice is kept as is; only an unset border is derived.
    const border = custom(page.cssBorderColor, DEFAULTS.border);
    pageColors = {
      background,
      font,
      lightFont: readable(custom(page.cssLightFontColor, DEFAULTS.lightFont), mix(font, background, 0.75)),
      border: border ?? mix(font, background, 0.2),
    };
  }
  return { page: pageColors, noData: custom(page.cssNoData, DEFAULTS.noData) };
}

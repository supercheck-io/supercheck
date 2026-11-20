/** The one email palette. The header is always PALETTE.neutral; other tones only tint small body badges. */
export const PALETTE = {
  failure: "#b91c1c",
  warning: "#b45309",
  success: "#15803d",
  info: "#1d4ed8",
  neutral: "#1f2937",
} as const;

export type PaletteTone = keyof typeof PALETTE;

/** Badge colours: dark text on a pale tint, readable without relying on colour alone. */
export const TONES: Record<PaletteTone, { fg: string; bg: string }> = {
  failure: { fg: "#991b1b", bg: "#fee2e2" },
  warning: { fg: "#92400e", bg: "#fef3c7" },
  success: { fg: "#166534", bg: "#dcfce7" },
  info: { fg: "#1e40af", bg: "#dbeafe" },
  neutral: { fg: "#374151", bg: "#f3f4f6" },
};

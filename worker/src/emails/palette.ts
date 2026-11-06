/** The one email palette: dark enough for white header text. Info is not warning. */
export const PALETTE = {
  failure: "#b91c1c",
  warning: "#b45309",
  success: "#15803d",
  info: "#1d4ed8",
  neutral: "#1f2937",
} as const;

export type PaletteTone = keyof typeof PALETTE;

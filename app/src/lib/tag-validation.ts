/** Name rules for a tag created or renamed through the tag API; returns the error message, or null when valid. */
export function tagNameError(name: string): string | null {
  if (!name) return "Tag name cannot be empty";
  if (name.length < 3 || name.length > 20) return "Tag name must be between 3 and 20 characters";
  if (/\s/.test(name)) return "Tag name cannot contain spaces";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "Tag name can only contain letters, numbers, underscores, and hyphens";
  return null;
}

/** Tag colours are #RRGGBB: the UI appends an alpha byte, and the column holds 50 characters. */
export function tagColorError(color: unknown): string | null {
  if (color === undefined || color === null || color === "") return null;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return "Tag color must be a hex color like #3B82F6";
  return null;
}

/** Name rules for a tag created or renamed through the tag API; returns the error message, or null when valid. */
export function tagNameError(name: string): string | null {
  if (!name) return "Tag name cannot be empty";
  if (name.length < 3 || name.length > 20) return "Tag name must be between 3 and 20 characters";
  if (/\s/.test(name)) return "Tag name cannot contain spaces";
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return "Tag name can only contain letters, numbers, underscores, and hyphens";
  return null;
}

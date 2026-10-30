// Pure helpers (no I/O), shared by the avatar UI and the server-side profile guard.
/** Static preset avatars in public/avatars (Notionists, CC0 1.0). */
export const AVATAR_PRESETS: readonly string[] = Array.from(
  { length: 24 },
  (_, i) => `/avatars/notionists-${String(i + 1).padStart(2, "0")}.svg`,
);

export function isAvatarPreset(image: unknown): image is string {
  return typeof image === "string" && AVATAR_PRESETS.includes(image);
}

// shortcut: seeded by the display name (most callers have no user id), so a rename changes the default.
export function defaultAvatarFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length];
}

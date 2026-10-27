// Pure helpers (no S3 client), safe to import from auth hooks.
const VERSION = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

/** The app route stored in user.image. The version names the object, so every change busts caches. */
export function avatarPath(userId: string, version: string): string {
  return `/api/users/${userId}/avatar?v=${version}`;
}

/** Returns the stored object version when `image` is this user's avatar route, otherwise null (e.g. an OAuth URL). */
export function avatarVersionOf(userId: string, image: string | null | undefined): string | null {
  const prefix = `/api/users/${userId}/avatar?v=`;
  if (!image?.startsWith(prefix)) return null;
  const version = image.slice(prefix.length);
  return VERSION.test(version) ? version : null;
}

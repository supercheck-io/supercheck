interface CredentialOwner {
  banned?: unknown;
  banExpires?: unknown;
}

/** Use the current owner row, never a ban claim cached in a credential. */
export function isCredentialOwnerActive<T extends CredentialOwner>(owner: T | null | undefined): owner is T {
  if (!owner) return false;
  if (!owner.banned) return true;
  const expires = owner.banExpires;
  return (expires instanceof Date || typeof expires === "string")
    && new Date(expires).getTime() <= Date.now();
}

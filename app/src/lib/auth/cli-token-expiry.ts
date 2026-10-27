import type { AuthContext } from "@/lib/auth-context";

/**
 * Expiry in seconds for a credential minted by this request. A CLI token may mint credentials,
 * but none that outlive it, so a stolen token cannot buy a longer-lived replacement.
 * Returns null when the authenticating CLI token has already expired.
 */
export function capExpiryToCliToken(
  context: Pick<AuthContext, "isCliAuth" | "cliTokenExpiresAt">,
  expiresIn: number | undefined,
): number | undefined | null {
  if (!context.isCliAuth || !context.cliTokenExpiresAt) return expiresIn;
  const remaining = Math.floor((context.cliTokenExpiresAt.getTime() - Date.now()) / 1000);
  if (remaining <= 0) return null;
  return Math.min(expiresIn ?? remaining, remaining);
}

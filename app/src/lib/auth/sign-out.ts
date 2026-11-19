import { signOut } from "@/utils/auth-client";
import { clearAuthSession } from "@/components/auth-guard";
import { resetChatwootSession } from "@/components/support/chatwoot-widget";
import { clearQueryCache } from "@/lib/query-provider";
import { clearProjectsCache } from "@/hooks/use-project-context";

/** Ends the session after dropping every client-side cache, so the next user never sees this one's data. */
export async function signOutAndClear() {
  clearAuthSession();
  clearProjectsCache();
  clearQueryCache();
  resetChatwootSession(); // the next user must not see this support-chat conversation
  return signOut();
}

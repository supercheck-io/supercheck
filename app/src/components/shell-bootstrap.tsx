"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSession } from "@/utils/auth-client";
import type { ImpersonationStatus } from "@/lib/impersonation-status";
import type { SetupSummary, UserPreferencesDto } from "@/lib/setup/types";

/**
 * Values the app shell needs on every page that the server layout already read for this request.
 * Hooks start from them instead of requesting each one after hydration. Every field is optional:
 * a missing one (outside the main layout, or a failed server read) leaves that hook on its request.
 */
export interface ShellBootstrap {
  /** The user these values were read for. */
  userId: string;
  /** When the server read these values (ms since epoch); hooks treat them as fresh from then. */
  readAt: number;
  adminStatus?: { isAdmin: boolean; isOrgAdmin: boolean };
  impersonation?: ImpersonationStatus;
  preferences?: UserPreferencesDto;
  /** Only for the project the layout rendered; a hook for another project ignores it. */
  setupSummary?: { projectId: string; summary: SetupSummary };
}

const ShellBootstrapContext = createContext<ShellBootstrap | undefined>(undefined);

export function ShellBootstrapProvider({ value, children }: { value: ShellBootstrap; children: ReactNode }) {
  return <ShellBootstrapContext.Provider value={value}>{children}</ShellBootstrapContext.Provider>;
}

/**
 * The layout's values, or undefined once the signed-in user is someone else (another tab switched account
 * or started impersonating). The layout's values do not change on client navigation, so after such a switch
 * they would describe the previous user; the hooks then request fresh values instead.
 */
export function useShellBootstrap(): ShellBootstrap | undefined {
  const bootstrap = useContext(ShellBootstrapContext);
  const sessionUserId = useSession().data?.user?.id;
  if (!bootstrap) return undefined;
  // While the browser's session check is still pending, the server's user is the signed-in user.
  return sessionUserId === undefined || sessionUserId === bootstrap.userId ? bootstrap : undefined;
}

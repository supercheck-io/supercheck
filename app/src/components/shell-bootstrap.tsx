"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ImpersonationStatus } from "@/lib/impersonation-status";
import type { SetupSummary, UserPreferencesDto } from "@/lib/setup/types";

/**
 * Values the app shell needs on every page that the server layout already read for this request.
 * Hooks start from them instead of requesting each one after hydration. Every field is optional:
 * a missing one (outside the main layout, or a failed server read) leaves that hook on its request.
 */
export interface ShellBootstrap {
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

export function useShellBootstrap(): ShellBootstrap | undefined {
  return useContext(ShellBootstrapContext);
}

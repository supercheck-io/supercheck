"use client";

import { useSyncExternalStore } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppConfig } from "@/hooks/use-app-config";

// Hydration-safe subscribe function - returns no-op unsubscribe
const subscribe = () => () => { };

// Returns false on server, true on client after hydration
function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,  // Client snapshot - hydrated
    () => false  // Server snapshot - not hydrated
  );
}

export function DemoBadge() {
  const hydrated = useHydrated();
  const { isDemoMode, isLoading } = useAppConfig();

  // Always return null on server to avoid hydration mismatch
  // Only show content after client hydration when we know the config
  if (!hydrated || isLoading || !isDemoMode) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="px-2 pb-1 rounded-sm bg-orange-100 text-orange-800 border  hover:bg-orange-200 transition-colors cursor-pointer dark:bg-orange-900/20 dark:text-orange-200 dark:hover:bg-orange-900/30">
            <span className="text-xs font-medium text-center">DEMO</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="p-2">
            <div className="font-semibold text-sm mb-1">Demo Mode</div>
            <div className="text-sm text-muted-foreground">
              You&apos;re in Demo Mode — showcasing app features only. No data is stored, the app runs on limited hardware, and data resets periodically.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
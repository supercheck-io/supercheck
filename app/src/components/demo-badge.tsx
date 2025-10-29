import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DemoBadgeProps {
  isDemoMode?: boolean;
}

export function DemoBadge({ isDemoMode = false }: DemoBadgeProps = {}) {
  if (!isDemoMode) {
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
You’re in Demo Mode — showcasing app features only. No data is stored, the app runs on limited hardware, and data resets periodically. Email invites and email notifications may not arrive if the daily quota is exhausted.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
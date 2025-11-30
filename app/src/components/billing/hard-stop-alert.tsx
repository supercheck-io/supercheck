"use client";

import { ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface HardStopAlertProps {
  isActive: boolean;
  currentSpending: number;
  limit: number;
  className?: string;
}

/**
 * HardStopAlert - Compact indicator when billing hard stop is active
 * 
 * Shows a subtle but clear indicator that executions are blocked
 * due to spending limit. Designed to fit inline without disrupting layout.
 */
export function HardStopAlert({
  isActive,
  currentSpending,
  limit,
  className,
}: HardStopAlertProps) {
  if (!isActive) return null;

  return (
    <Badge 
      variant="destructive" 
      className={`gap-1.5 px-2.5 py-1 ${className || ""}`}
    >
      <ShieldOff className="h-3.5 w-3.5" />
      <span>Hard Stop Active</span>
      <span className="opacity-75">
        (${currentSpending.toFixed(2)}/${limit.toFixed(2)})
      </span>
    </Badge>
  );
}

export default HardStopAlert;

"use client";

import React, { useMemo } from "react";
import { Clock } from "lucide-react";
import { getNextRunDate, formatNextRunDate } from "@/lib/cron-utils";

interface NextRunDisplayProps {
  cronExpression: string | null | undefined;
}

const NextRunDisplay: React.FC<NextRunDisplayProps> = ({ cronExpression }) => {
  // Compute next run date directly - no need for useState/useEffect
  const nextRun = useMemo(() => {
    if (!cronExpression || cronExpression.trim() === "") {
      return "No date";
    }
    try {
      const nextDate = getNextRunDate(cronExpression);
      return formatNextRunDate(nextDate);
    } catch (error) {
      console.error("Error calculating next run date:", error);
      return "No date";
    }
  }, [cronExpression]);

  if (!cronExpression || cronExpression.trim() === "") {
    return null;
  }

  return (
    <div className="flex items-center text-sm text-muted-foreground mt-2">
      <Clock className="h-4 w-4 mr-2 text-blue-500" />
      <span>Next run: {nextRun}</span>
    </div>
  );
};

export default NextRunDisplay;

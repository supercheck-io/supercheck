"use client";

import React, { useEffect, useRef } from "react";
import { Cron, OnError } from "react-js-cron";
import "react-js-cron/dist/styles.css"; // Import base styles
import { Input } from "@/components/ui/input"; // Import shadcn Input
import { Button } from "@/components/ui/button"; // Import shadcn Button
import { X, Clock, CalendarClock } from "lucide-react"; // Import icons

interface CronSchedulerProps {
  value: string;
  onChange: (value: string) => void;
  onError?: OnError; // Use the type from the library
  disabled?: boolean;
  readOnly?: boolean;
}

// Default cron expression when user enables scheduling
const DEFAULT_CRON = "0 0 * * 0"; // Weekly on Sunday at midnight UTC

const CronScheduler: React.FC<CronSchedulerProps> = ({
  value,
  onChange,
  onError,
  disabled = false,
  readOnly = false,
}) => {
  const originalConsoleWarn = useRef<typeof console.warn>(console.warn);

  // Whether to show the scheduler is simply derived from whether there's a value
  // No need for separate state since handleEnableScheduling immediately sets a default value
  const isSchedulerVisible = !!value;

  useEffect(() => {
    // Store original console.warn
    originalConsoleWarn.current = console.warn;

    // Override console.warn to filter out the specific Ant Design deprecation warning
    console.warn = (...args: unknown[]) => {
      const message = args[0];

      // Filter out the specific antd Select popupClassName deprecation warning
      if (
        typeof message === 'string' &&
        message.includes('[antd: Select]') &&
        message.includes('popupClassName') &&
        message.includes('deprecated')
      ) {
        return; // Suppress this specific warning
      }

      // Pass all other warnings through
      originalConsoleWarn.current?.(...args);
    };

    // Cleanup: restore original console.warn on unmount
    return () => {
      if (originalConsoleWarn.current) {
        console.warn = originalConsoleWarn.current;
      }
    };
  }, []);

  // Handle enabling scheduling
  const handleEnableScheduling = () => {
    onChange(DEFAULT_CRON); // Set default schedule when enabling
  };

  // Handle disabling scheduling
  const handleDisableScheduling = () => {
    onChange(""); // Clear the schedule
  };

  // Show "Not Scheduled" state when scheduler is not visible
  if (!isSchedulerVisible) {
    return (
      <div className="cron-widget-container space-y-2">
        <div className="flex items-center gap-3 p-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">Not Scheduled</p>
            <p className="text-xs text-muted-foreground/70">Job will only run when manually triggered</p>
          </div>
          {!readOnly && !disabled && (
            <Button 
              type="button" 
              variant="outline" 
              size="sm"
              onClick={handleEnableScheduling}
              className="shrink-0"
            >
              <CalendarClock className="h-4 w-4 mr-2" />
              Add Schedule
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cron-widget-container space-y-2"> 
      {/* The Cron component for visual editing */}
      <Cron
        value={value || DEFAULT_CRON}
        setValue={onChange}
        leadingZero // Use leading zeros for hours/minutes (e.g., 01 instead of 1)
        clearButton={false} // Hide the default clear button if desired
        shortcuts={false} // Disable shortcuts like @daily if not needed
        clockFormat="24-hour-clock" // Set 24-hour format
        disabled={disabled}
        readOnly={readOnly}
        onError={onError} // Pass the error handler
        // Only allow hourly and larger periods (no minutes)
        allowedPeriods={['year', 'month', 'week', 'day', 'hour']}
        // Remove 'minutes' from dropdowns to prevent minute-level scheduling
        allowedDropdowns={['period', 'months', 'month-days', 'week-days', 'hours']}
        // Set default period to week for weekly scheduling
        defaultPeriod="week"
      />
      
      {/* Read-only input to display the generated cron string */}
      <div className="flex items-center space-x-2">
        <Input 
          readOnly 
          value={value} 
          placeholder="Cron schedule will appear here..." 
          className="flex-grow"
          style={{ maxWidth: '250px' }} // Limit width of the read-only input
        />
        {/* Button to remove the schedule */}
        {value && !readOnly && !disabled && (
          <Button 
            type="button" 
            variant="secondary"
            size="sm"
            onClick={handleDisableScheduling}
            aria-label="Remove schedule"
          >
            <X className="h-4 w-4 text-destructive" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
};

export default CronScheduler; 
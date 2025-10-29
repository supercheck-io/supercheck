"use client";

import React from "react";
import { Cron, OnError } from "react-js-cron";
import "react-js-cron/dist/styles.css"; // Import base styles
import { Input } from "@/components/ui/input"; // Import shadcn Input
import { Button } from "@/components/ui/button"; // Import shadcn Button
import { X } from "lucide-react"; // Import icons
import { toast } from "sonner"; // Import toast

interface CronSchedulerProps {
  value: string;
  onChange: (value: string) => void;
  onError?: OnError; // Use the type from the library
  disabled?: boolean;
  readOnly?: boolean;
}

// Define custom locale if needed, or use defaults
// import { Locale } from 'react-js-cron'
// const customLocale: Partial<Locale> = { ... }

const CronScheduler: React.FC<CronSchedulerProps> = ({
  value,
  onChange,
  onError,
  disabled = false,
  readOnly = false,
}) => {

  return (
    <div className="cron-widget-container space-y-2"> 
      {/* The Cron component for visual editing */}
      <Cron
        value={value || "0 0 * * 0"} // Default to "every week" (Sunday at midnight) if no value
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
        {/* Button to clear the schedule */}
        {value && !readOnly && !disabled && (
          <Button 
            type="button" 
            variant="secondary" // Make the clear button red
            size="sm"
            onClick={() => {
              onChange(""); // Clear the value
              toast.success("Cron schedule will be removed after job update"); // Show success toast message
            }}
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
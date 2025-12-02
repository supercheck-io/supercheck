"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TruncatedTextWithTooltipProps {
  text: string;
  maxLength?: number;
  className?: string;
  maxWidth?: string;
  showTooltipOnTruncation?: boolean;
}

export function TruncatedTextWithTooltip({ 
  text, 
  maxLength = 20, 
  className = "",
  maxWidth = "160px",
  showTooltipOnTruncation = true 
}: TruncatedTextWithTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Check if text is likely to be truncated
  const isTruncated = text.length > maxLength;
  
  if (!showTooltipOnTruncation || !isTruncated) {
    return (
      <div className={`truncate ${className}`} style={{ maxWidth }}>
        {text}
      </div>
    );
  }
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div 
          className={`cursor-pointer truncate ${className}`}
          style={{ maxWidth }}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {text}
        </div>
      </PopoverTrigger>
      <PopoverContent className="flex justify-center items-center w-auto max-w-[500px] min-w-0">
        <div className="space-y-2 min-w-0">
          <p className="text-xs text-muted-foreground break-words">
            {text}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
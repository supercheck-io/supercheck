"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

interface UUIDFieldProps {
  value: string;
  className?: string;
  maxLength?: number;
  onCopy?: (value: string) => void;
}

export function UUIDField({
  value,
  className,
  maxLength,
  onCopy,
}: UUIDFieldProps) {
  // Format the UUID for display if it needs to be shortened
  const displayValue =
    maxLength && value.length > maxLength
      ? `${value.substring(0, maxLength)}...`
      : value;

  const isTruncated = maxLength && value.length > maxLength;

  if (!isTruncated) {
    return (
      <div
        className={cn(
          "group relative inline-flex items-center w-full",
          className
        )}
      >
        <code className="font-mono text-xs bg-muted/60 dark:bg-muted px-1.5 p-1 rounded pr-1 truncate ">{displayValue}</code>
        <CopyButton value={value} onCopy={onCopy} className="ml-1" />
      </div>
    );
  }

  return (    
          <div
            className={cn(
              "group relative inline-flex items-center w-full",
              className
            )}
          >
            <code className="font-mono text-xs bg-muted/60 dark:bg-muted px-2 p-1 rounded-sm pr-1 truncate ">{displayValue}</code>
            <CopyButton value={value} onCopy={onCopy} className="ml-1" />
          </div>   
  );
}

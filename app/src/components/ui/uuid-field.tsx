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

  return (
    <div className={cn("group inline-flex items-center h-full", className)}>
      <code className="font-mono text-xs bg-muted/60 dark:bg-muted px-2 py-1 rounded-sm">
        {displayValue}
      </code>
      <CopyButton value={value} onCopy={onCopy} className="ml-1.5" />
    </div>
  );
}

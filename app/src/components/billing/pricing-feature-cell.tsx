"use client";

import { Check, X } from "lucide-react";

interface PricingFeatureCellProps {
  value: string | boolean | number;
  align?: "left" | "center" | "right";
}

export function PricingFeatureCell({
  value,
  align = "center",
}: PricingFeatureCellProps) {
  const alignClass =
    align === "left"
      ? "justify-start"
      : align === "right"
        ? "justify-end"
        : "justify-center";

  // Boolean values - show check or X
  if (typeof value === "boolean") {
    return (
      <div className={`flex ${alignClass}`}>
        {value ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
    );
  }

  // String values
  if (typeof value === "string") {
    // Check for special values that should be highlighted
    if (value === "Enhanced" || value === "Priority" || value === "Full") {
      return (
        <span className="text-sm font-medium text-primary">{value}</span>
      );
    }

    // Check for infinity-like values
    if (value === "Unlimited") {
      return (
        <span className="text-sm font-medium">∞</span>
      );
    }

    // Regular text
    return <span className="text-sm">{value}</span>;
  }

  // Numeric values
  return <span className="text-sm font-semibold">{value}</span>;
}

"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SelectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  className?: string;
}

export function SelectionCard({
  icon,
  title,
  description,
  onClick,
  className,
  ...props
}: SelectionCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      className={cn(
        "hover:border-primary/70 hover:shadow-md transition-all cursor-pointer h-full rounded-lg border border-border/60",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      {...props}
    >
      <div className="h-full p-6">
        <div className="flex items-start gap-4">
          <div className="text-primary shrink-0">{icon}</div>
          <div className="flex-1">
            <div className="font-semibold text-base leading-tight">{title}</div>
            {description && (
              <div className="text-sm text-muted-foreground leading-relaxed mt-2">
                {description}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

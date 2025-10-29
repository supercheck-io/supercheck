"use client";

import React from "react";
import {
  Card,

} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";


interface CreateCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick?: () => void;
  className?: string;
}

export function CreateCard({
  icon,
  title,
  description,
  onClick,
  className,
  ...props
}: CreateCardProps) {
  const showExternalIcon = title === "Record";
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      className={cn(
        "hover:border-primary hover:shadow-sm transition-all cursor-pointer h-auto",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      {...props}
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="text-primary shrink-0">{icon}</div>
          <div className="font-medium text-sm flex-1">{title}</div>
          {showExternalIcon && (
            <div className="text-muted-foreground shrink-0">
              <ExternalLink className="h-4 w-4" />
            </div>
          )}
        </div>
        {description && (
          <div className="text-xs text-muted-foreground leading-relaxed mt-2">{description}</div>
        )}
      </div>
    </Card>
  );
}
